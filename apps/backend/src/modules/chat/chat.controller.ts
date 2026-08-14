import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/chat.dto';
import { AuthGuard } from '../../common/auth.guard';

@UseGuards(AuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post()
  async send(@Body() dto: SendMessageDto) {
    const reply = await this.chatService.sendMessage(dto.messages, dto.model);
    return { reply };
  }
}
