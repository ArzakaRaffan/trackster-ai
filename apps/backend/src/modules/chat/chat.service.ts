import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async sendMessage(
    messages: ChatMessage[],
    model: string,
    sessionId?: number,
    userId?: number,
  ): Promise<string> {
    const baseUrl = process.env.CHAT_API_BASE_URL;
    const apiKey = process.env.CHAT_API_KEY;

    if (!baseUrl || !apiKey) {
      throw new BadRequestException('CHAT_API_BASE_URL / CHAT_API_KEY belum di-konfigurasi');
    }

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

    if (sessionId && userId) {
      await this.persistChatMessages(sessionId, userId, messages, reply);
    }

    return reply;
  }

  async streamChat(
    messages: ChatMessage[],
    model: string,
    onChunk: (chunk: string) => void,
    sessionId?: number,
    userId?: number,
  ): Promise<void> {
    const baseUrl = process.env.CHAT_API_BASE_URL;
    const apiKey = process.env.CHAT_API_KEY;

    if (!baseUrl || !apiKey) {
      throw new BadRequestException('CHAT_API_BASE_URL / CHAT_API_KEY belum di-konfigurasi');
    }

    // Attempt real streaming with `stream: true`
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new BadRequestException(`Chat API error (HTTP ${response.status}): ${errText.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const isSse = contentType.includes('text/event-stream');

    let fullReply = '';

    if (!isSse) {
      // Provider ignored `stream: true`; fallback to non‑stream response and simulate typing.
      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content;
      if (!reply) {
        throw new BadRequestException('Response chat API tidak berisi jawaban yang valid');
      }
      await this.simulateTyping(reply, onChunk);
      fullReply = reply;
    } else {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new BadRequestException('Body response streaming tidak tersedia');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          const dataLine = event.split('\n').find((line) => line.startsWith('data: '));
          if (!dataLine) continue;

          const data = dataLine.slice(6).trim();
          if (data === '[DONE]') {
            done = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullReply += delta;
              onChunk(delta);
            }
          } catch {
            // ignore malformed JSON chunks
          }
        }
      }
    }

    if (sessionId && userId) {
      await this.persistChatMessages(sessionId, userId, messages, fullReply);
    }
  }

  private async persistChatMessages(
    sessionId: number,
    userId: number,
    messages: ChatMessage[],
    assistantReply: string,
  ): Promise<void> {
    // Safety: ensure session belongs to the requesting user
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId, isDeleted: false },
    });
    if (!session) {
      throw new BadRequestException('Session tidak ditemukan atau sudah dihapus');
    }

    const userMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    if (!userMessage) return;

    const title =
      session.title && session.title !== 'New Chat'
        ? session.title
        : userMessage.content.slice(0, 40).trim() || 'New Chat';

    await this.prisma.$transaction([
      this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          title,
          lastMessageAt: new Date(),
          // updatedAt is handled automatically by @updatedAt
        },
      }),
      this.prisma.chatMessage.createMany({
        data: [
          { sessionId, role: 'user', content: userMessage.content },
          { sessionId, role: 'assistant', content: assistantReply },
        ],
      }),
    ]);
  }

  private async simulateTyping(text: string, onChunk: (chunk: string) => void): Promise<void> {
    const chunkSize = 6;
    for (let i = 0; i < text.length; i += chunkSize) {
      const chunk = text.slice(i, i + chunkSize);
      onChunk(chunk);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
}
