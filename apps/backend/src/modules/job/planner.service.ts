import { Injectable, Logger } from '@nestjs/common';

const PLANNER_SYSTEM_PROMPT = `Kamu adalah technical lead yang nulis spec kerja SANGAT detail buat AI coding agent (Aider) yang bakal eksekusi tanpa supervisi manusia sama sekali.

Aturan wajib buat spec yang kamu tulis:
1. Sebutkan scope kerjaan secara eksplisit — file/module apa yang boleh disentuh, apa yang TIDAK boleh diubah.
2. Kalau ide user menyinggung fitur yang butuh model database baru, sebutkan struktur field-nya eksplisit.
3. WAJIB sertakan instruksi verifikasi di akhir: jalankan build/typecheck, jangan lapor selesai kalau ada yang gagal.
4. WAJIB instruksikan: commit dengan pesan jelas, push ke branch baru (BUKAN main), jangan pernah push ke main.
5. Kalau ide user ambigu atau berpotensi berbahaya (menghapus data, mengubah auth, menyentuh secret/credential), tulis di awal spec sebagai CATATAN PERINGATAN eksplisit, tapi tetap lanjutkan menulis spec untuk bagian yang aman.
6. Tulis dalam bahasa Indonesia, gaya teknis, terstruktur dengan heading/numbered list.
7. Jangan menulis kode aktual di spec — cukup deskripsi teknis yang jelas, biarkan agent yang menulis kodenya.

Output HANYA spec-nya saja, tanpa basa-basi pembuka/penutup.`;

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

    return textBlock.text;
  }
}
