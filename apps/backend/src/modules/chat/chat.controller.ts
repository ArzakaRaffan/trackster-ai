import { Body, Controller, Post, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/chat.dto';
import { AuthGuard } from '../../common/auth.guard';

@UseGuards(AuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('stream')
  async stream(@Body() dto: SendMessageDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      await this.chatService.streamChat(dto.messages, dto.model, (chunk) => {
        res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
      });
      res.write(`data: [DONE]\n\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan';
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } finally {
      res.end();
    }
  }

  @Post()
  async send(@Body() dto: SendMessageDto) {
    const reply = await this.chatService.sendMessage(dto.messages, dto.model);
    return { reply };
  }
}
