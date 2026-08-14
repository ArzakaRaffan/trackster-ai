import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

/**
 * Guard KEDUA, khusus dipasang di endpoint yang bisa TRIGGER agent beneran ngedit kode
 * (create job, approve, edit plan, delete). Terpisah dari AuthGuard biasa (login) —
 * siapapun yang login tetap harus tau secret ini juga, yang cuma diketahui admin.
 *
 * Dikirim via header 'x-agent-secret', BUKAN cookie, karena ini bukan sesi — user harus
 * masukin ulang tiap kali mau trigger aksi sensitif (sesuai permintaan: "ketika memencet
 * akan dimintai password lagi").
 */
@Injectable()
export class AgentSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-agent-secret'];

    if (!provided || provided !== process.env.AGENT_ACCESS_SECRET) {
      throw new ForbiddenException('Password agent salah atau belum diisi');
    }
    return true;
  }
}
