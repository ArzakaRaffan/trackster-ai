import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatSessionController } from './chat-session.controller';
import { ChatSessionService } from './chat-session.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../../prisma.service';

@Module({
  imports: [AuthModule],
  controllers: [ChatController, ChatSessionController],
  providers: [ChatService, ChatSessionService, PrismaService],
})
export class ChatModule {}
