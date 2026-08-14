import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/chat.dto';
import { AuthGuard } from '../../common/auth.guard';
import { ChatSessionService } from './chat-session.service';

@UseGuards(AuthGuard)
@Controller('chat')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private chatSessionService: ChatSessionService,
  ) {}

  @Post('stream')
  async stream(@Body() dto: SendMessageDto, @Req() req: Request, @Res() res: Response) {
    const userId = (req as any).user?.sub;
    if (dto.sessionId && userId) {
      await this.chatSessionService.findSessionForUser(dto.sessionId, userId);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      await this.chatService.streamChat(
        dto.messages,
        dto.model,
        (chunk) => {
          res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
        },
        dto.sessionId,
        userId,
      );
      res.write(`data: [DONE]\n\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan';
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } finally {
      res.end();
    }
  }

  @Post()
  async send(@Body() dto: SendMessageDto, @Req() req: Request) {
    const userId = (req as any).user?.sub;
    if (dto.sessionId && userId) {
      await this.chatSessionService.findSessionForUser(dto.sessionId, userId);
    }

    const reply = await this.chatService.sendMessage(
      dto.messages,
      dto.model,
      dto.sessionId,
      userId,
    );
    return { reply };
  }
}
