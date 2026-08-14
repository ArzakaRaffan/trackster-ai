import { Injectable, BadRequestException } from '@nestjs/common';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class ChatService {
  async sendMessage(messages: ChatMessage[], model: string): Promise<string> {
    const baseUrl = process.env.CHAT_API_BASE_URL;
    const apiKey = process.env.CHAT_API_KEY;

    if (!baseUrl || !apiKey) {
      throw new BadRequestException('CHAT_API_BASE_URL / CHAT_API_KEY belum di-konfigurasi');
    }

    // Endpoint chat completions, format OpenAI-compatible (yang dipakai kebanyakan reseller multi-model)
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BadRequestException(`Chat API error (HTTP ${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) {
      throw new BadRequestException('Response chat API tidak berisi jawaban yang valid');
    }
    return reply;
  }
}
