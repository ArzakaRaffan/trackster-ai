import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { IsString } from 'class-validator';
import { AuthGuard, COOKIE_NAME } from '../../common/auth.guard';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

const isProd = process.env.NODE_ENV === 'production';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.authService.validateAndLogin(dto.username, dto.password);

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      domain: process.env.COOKIE_DOMAIN || undefined,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    return { user };
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME, { domain: process.env.COOKIE_DOMAIN || undefined });
    return { success: true };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  async me(@Req() req: Request) {
    const payload = (req as any).user;
    const user = await this.authService.getUserById(payload.sub);
    return { user };
  }
}
