import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ChatSessionService {
  constructor(private prisma: PrismaService) {}

  async createSession(userId: number, title?: string) {
    return this.prisma.chatSession.create({
      data: {
        userId,
        title: title?.trim() || 'New Chat',
      },
    });
  }

  async listSessions(userId: number) {
    return this.prisma.chatSession.findMany({
      where: { userId, isDeleted: false },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        createdAt: true,
      },
    });
  }

  async getSession(id: number, userId: number) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id, userId, isDeleted: false },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Chat session tidak ditemukan');
    }
    return session;
  }

  async findSessionForUser(sessionId: number, userId: number) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId, isDeleted: false },
    });
    if (!session) {
      throw new NotFoundException('Session tidak ditemukan atau sudah dihapus');
    }
    return session;
  }

  async softDeleteSession(id: number, userId: number) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id, userId, isDeleted: false },
    });

    if (!session) {
      throw new NotFoundException('Chat session tidak ditemukan');
    }

    await this.prisma.chatSession.update({
      where: { id },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    return { success: true };
  }
}
