import { Injectable, Logger } from '@nestjs/common';

const PLANNER_SYSTEM_PROMPT = `Kamu adalah technical lead yang nulis spec kerja SANGAT detail buat AI coding agent (Aider) yang bakal eksekusi tanpa supervisi manusia sama sekali.

JANGAN PERNAH memanggil/menggunakan tool atau function apapun, meskipun tersedia di environment kamu — kamu TIDAK PUNYA akses baca file sungguhan, dan kamu TIDAK PERLU baca file apapun buat nulis spec ini. Cukup jawab dengan teks spec biasa berdasarkan deskripsi ide dari user, jangan coba eksekusi apapun. Kalau ide user menyebut path file spesifik, itu cuma konteks — bukan instruksi buat kamu buka file itu.

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

@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  async generatePlan(idea: string, repoContext?: string): Promise<string> {
    const baseUrl = process.env.PLANNER_API_BASE_URL || 'https://api.anthropic.com';
    const apiKey = process.env.PLANNER_API_KEY;
    const model = process.env.PLANNER_MODEL || 'claude-sonnet-5';

    if (!apiKey) {
      throw new Error('PLANNER_API_KEY belum di-set di environment');
    }

    const userMessage = repoContext
      ? `Konteks repo target:\n${repoContext}\n\nIde dari user:\n${idea}`
      : `Ide dari user:\n${idea}`;

    const res = await fetch(`${baseUrl}/v1/messages`, {
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
    const text = textBlock.text.trim();
    if (text.length < 200 || /^[{[]/.test(text)) {
      this.logger.error(`Planner response mencurigakan (bukan spec valid): ${text.slice(0, 200)}`);
      throw new Error('Planner mengembalikan response yang bukan spec teks valid, coba submit ulang');
    }

    return textBlock.text;
  }
}
