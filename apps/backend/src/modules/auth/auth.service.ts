import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateAndLogin(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) throw new UnauthorizedException('Username atau password salah');

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException('Username atau password salah');

    const token = await this.jwtService.signAsync(
      { sub: user.id, username: user.username },
      { secret: process.env.JWT_SECRET, expiresIn: '30d' },
    );
    return { token, user: { id: user.id, username: user.username } };
  }

  async getUserById(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    return { id: user.id, username: user.username };
  }
}
