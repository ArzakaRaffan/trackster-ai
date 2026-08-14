import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ChatSessionService } from './chat-session.service';
import { AuthGuard } from '../../common/auth.guard';

@UseGuards(AuthGuard)
@Controller('chat-sessions')
export class ChatSessionController {
  constructor(private chatSessionService: ChatSessionService) {}

  @Post()
  async create(@Req() req: Request, @Body() body: { title?: string }) {
    const userId = (req as any).user.sub;
    return this.chatSessionService.createSession(userId, body?.title);
  }

  @Get()
  async list(@Req() req: Request) {
    const userId = (req as any).user.sub;
    return this.chatSessionService.listSessions(userId);
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const userId = (req as any).user.sub;
    return this.chatSessionService.getSession(id, userId);
  }

  @Delete(':id')
  async delete(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const userId = (req as any).user.sub;
    return this.chatSessionService.softDeleteSession(id, userId);
  }
}
