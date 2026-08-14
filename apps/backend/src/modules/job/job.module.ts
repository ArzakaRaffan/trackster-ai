import { Module } from '@nestjs/common';
import { JobController } from './job.controller';
import { JobService } from './job.service';
import { PlannerService } from './planner.service';
import { PrismaService } from '../../prisma.service';
import { AgentSecretGuard } from '../../common/agent-secret.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [JobController],
  providers: [JobService, PlannerService, PrismaService, AgentSecretGuard],
})
export class JobModule {}
