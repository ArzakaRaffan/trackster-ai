import { Injectable, Logger } from '@nestjs/common';

const PLANNER_SYSTEM_PROMPT = `Kamu adalah technical lead yang nulis spec kerja SANGAT detail buat AI coding agent (Aider) yang bakal eksekusi tanpa supervisi manusia sama sekali.

JANGAN PERNAH memanggil/menggunakan tool atau function apapun, meskipun tersedia di environment kamu — kamu TIDAK PUNYA akses baca file sungguhan, dan kamu TIDAK PERLU baca file apapun buat nulis spec ini. Cukup jawab dengan teks spec biasa berdasarkan deskripsi ide dari user, jangan coba eksekusi apapun. Kalau ide user menyebut path file spesifik, itu cuma konteks — bukan instruksi buat kamu buka file itu.

WAJIB: baris PERTAMA dari jawaban kamu harus PERSIS format ini (buat nama branch git yang deskriptif):
BRANCH_SLUG: <slug-singkat-kebab-case-max-6-kata-bahasa-inggris>
Slug harus spesifik ke tugas ini (misal "fix-chat-sse-streaming", "redesign-dashboard-cards"), BUKAN kata generic sendirian kayak "update" atau "fix" doang. Baris kedua kosong. Baru mulai spec-nya dari baris ketiga.

Aturan wajib buat spec yang kamu tulis:
1. Sebutkan scope kerjaan secara eksplisit — file/module apa yang boleh disentuh, apa yang TIDAK boleh diubah.
1a. Kalau ide user memakai kata "redesign", "rombak", "ubah total", atau sejenisnya untuk UI, itu artinya user MENGIZINKAN perubahan struktural: layout, hierarki/susunan komponen, navigasi, penambahan atau penghapusan komponen — bukan cuma warna/spacing/typography. JANGAN otomatis mempersempit scope jadi "styling saja" kecuali user secara eksplisit bilang begitu (misal "jangan ubah struktur, cuma warnanya"). Batasan "jangan ubah business logic/API call/alur data" tetap berlaku terpisah dan tetap wajib disebutkan — itu bukan alasan untuk membatasi perubahan visual/struktural juga.
2. Kalau ide user menyinggung fitur yang butuh model database baru, sebutkan struktur field-nya eksplisit.
3. WAJIB sertakan instruksi verifikasi di akhir: jalankan build/typecheck, jangan lapor selesai kalau ada yang gagal.
4. WAJIB instruksikan: commit dengan pesan jelas, push ke branch baru (BUKAN main), jangan pernah push ke main.
5. Kalau ide user ambigu atau berpotensi berbahaya (menghapus data, mengubah auth, menyentuh secret/credential), tulis di awal spec sebagai CATATAN PERINGATAN eksplisit, tapi tetap lanjutkan menulis spec untuk bagian yang aman.
6. Tulis dalam bahasa Indonesia, gaya teknis, terstruktur dengan heading/numbered list.
7. Jangan menulis kode aktual di spec — cukup deskripsi teknis yang jelas, biarkan agent yang menulis kodenya.

Output HANYA spec-nya saja, tanpa basa-basi pembuka/penutup, dan jangan pernah output dalam format JSON/tool-call.`;

const PLANNER_PRICING_PER_MILLION_TOKENS = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-opus': { input: 15, output: 75 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-opus': { input: 15, output: 75 },
  'claude-haiku': { input: 0.25, output: 1.25 },
};

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  // mwapi.dev kadang balikin 429 "Upstream rate limit exceeded" -- ini rate limit di
  // KONEKSI mwapi.dev sendiri ke Anthropic (kemungkinan dibagi rame-rame sama semua
  // customer mereka), BUKAN limit akun kita sendiri (udah dicek langsung ke dashboard,
  // jauh dari limit). Sifatnya transient, biasanya reda dalam hitungan detik/menit --
  // jadi worth di-retry otomatis daripada langsung gagal dan user harus submit ulang manual.
  private async fetchWithRetry(url: string, init: RequestInit, maxRetries = 3): Promise<Response> {
    let lastRes: Response | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(url, init);
      if (res.status !== 429) return res;

      lastRes = res;
      if (attempt === maxRetries) break;

      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;
      const delayMs = !isNaN(retryAfterSec) ? retryAfterSec * 1000 : 2000 * 2 ** attempt; // 2s, 4s, 8s fallback

      this.logger.warn(`Planner API 429 (attempt ${attempt + 1}/${maxRetries + 1}), retry dalam ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return lastRes!;
  }

  async generatePlan(idea: string, repoContext?: string): Promise<{ plan: string; branchSlug: string | null; plannerCostUsd: number | null }> {
    const baseUrl = process.env.PLANNER_API_BASE_URL || 'https://api.anthropic.com';
    const apiKey = process.env.PLANNER_API_KEY;
    const model = process.env.PLANNER_MODEL || 'claude-sonnet-5';

    if (!apiKey) {
      throw new Error('PLANNER_API_KEY belum di-set di environment');
    }

    const userMessage = repoContext
      ? `Konteks repo target:\n${repoContext}\n\nIde dari user:\n${idea}`
      : `Ide dari user:\n${idea}`;

    const res = await this.fetchWithRetry(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: PLANNER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.logger.error(`Planner API error ${res.status}: ${errText}`);
      throw new Error(`Gagal generate plan (HTTP ${res.status})`);
    }

    const data = await res.json();
    const textBlock = data.content?.find((c: any) => c.type === 'text');
    if (!textBlock?.text) {
      throw new Error('Response planner tidak berisi teks yang valid');
    }

    // mwapi.dev kadang leak tool-call mentah (misal {"path": "..."}) sebagai text block
    // biasa alih-alih spec beneran -- tolak kalau kependekan/berbentuk JSON, jangan
    // diam-diam disimpan jadi "plan" yang rusak.
    const raw = textBlock.text.trim();
    if (raw.length < 200 || /^[{[]/.test(raw)) {
      this.logger.error(`Planner response mencurigakan (bukan spec valid): ${raw.slice(0, 200)}`);
      throw new Error('Planner mengembalikan response yang bukan spec teks valid, coba submit ulang');
    }

    // Parse baris pertama BRANCH_SLUG: ... yang diminta di system prompt. Kalau model
    // nggak nurut format-nya (jarang tapi bisa terjadi), fallback null -- job.service akan
    // pakai "job-<id>" polos, bukan blocking error, karena ini cuma buat penamaan branch.
    const slugMatch = raw.match(/^BRANCH_SLUG:\s*([a-z0-9-]+)\s*\n/i);
    const branchSlug = slugMatch ? slugMatch[1].toLowerCase() : null;
    const plan = slugMatch ? raw.slice(slugMatch[0].length).trim() : raw;

    if (plan.length < 200) {
      this.logger.error(`Plan tersisa kependekan setelah strip BRANCH_SLUG: ${plan.slice(0, 200)}`);
      throw new Error('Planner mengembalikan response yang bukan spec teks valid, coba submit ulang');
    }

    // Hitung biaya planner dari usage response (field usage.input_tokens/output_tokens)
    let plannerCostUsd: number | null = null;
    const usage = data.usage;
    if (usage && typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number') {
      const pricing = PLANNER_PRICING_PER_MILLION_TOKENS[model as keyof typeof PLANNER_PRICING_PER_MILLION_TOKENS];
      if (pricing) {
        const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
        const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
        plannerCostUsd = inputCost + outputCost;
      } else {
        this.logger.warn(`Tidak ada harga planner untuk model "${model}", cost tidak dihitung`);
      }
    }

    return { plan, branchSlug, plannerCostUsd };
  }
}
