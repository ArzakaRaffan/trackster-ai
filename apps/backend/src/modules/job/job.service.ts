import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PlannerService } from './planner.service';
import { JobStatus, JobMode } from '@prisma/client';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    private prisma: PrismaService,
    private planner: PlannerService,
  ) {}

  async create(
    idea: string,
    targetRepoKey: 'trackster' | 'ai-trackster' = 'trackster',
    mode: 'manual' | 'auto' = 'manual',
  ) {
    // Resolve dari env, BUKAN terima url mentah dari client -- biar job nggak bisa
    // diarahkan clone/push ke repo sembarangan lewat request yang dimanipulasi.
    const targetRepo =
      targetRepoKey === 'ai-trackster' ? process.env.SELF_REPO_URL : process.env.TARGET_REPO_URL;
    if (!targetRepo) {
      throw new BadRequestException(
        targetRepoKey === 'ai-trackster'
          ? 'SELF_REPO_URL belum di-konfigurasi di backend -- self-edit belum bisa dipakai'
          : 'TARGET_REPO_URL belum di-konfigurasi di backend',
      );
    }

    const job = await this.prisma.job.create({
      data: {
        idea,
        targetRepo,
        status: JobStatus.DRAFTING_PLAN,
        mode: mode === 'auto' ? JobMode.AUTO : JobMode.MANUAL,
      },
    });

    // Generate plan secara async, tidak blocking response create.
    // Kalau gagal, status balik ke gagal supaya user tahu, bukan nyangkut selamanya di DRAFTING_PLAN.
    this.generatePlanInBackground(job.id).catch((err) => {
      this.logger.error(`Gagal generate plan buat job ${job.id}: ${err.message}`);
    });

    return job;
  }

  private async generatePlanInBackground(jobId: number) {
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    try {
      const { plan, branchSlug } = await this.planner.generatePlan(job.idea);
      // Mode AUTO: skip nunggu approve manual, langsung QUEUED begitu plan jadi.
      // Mode MANUAL (default): tetap PLANNED, nunggu user approve kayak biasa.
      const nextStatus = job.mode === JobMode.AUTO ? JobStatus.QUEUED : JobStatus.PLANNED;
      await this.prisma.job.update({
        where: { id: jobId },
        data: { plan, branchSlug, status: nextStatus },
      });
    } catch (err) {
      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.FAILED, errorMessage: `Gagal generate plan: ${err.message}` },
      });
    }
  }

  async findAll() {
    return this.prisma.job.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job tidak ditemukan');
    return job;
  }

  async updatePlan(id: number, plan: string) {
    const job = await this.findOne(id);
    if (job.status !== JobStatus.PLANNED) {
      throw new BadRequestException('Plan cuma bisa diedit selagi status PLANNED');
    }
    return this.prisma.job.update({ where: { id }, data: { plan } });
  }

  /** Approve plan, job masuk antrian buat dieksekusi worker */
  async approve(id: number) {
    const job = await this.findOne(id);
    if (job.status !== JobStatus.PLANNED) {
      throw new BadRequestException('Cuma job dengan status PLANNED yang bisa di-approve');
    }
    return this.prisma.job.update({ where: { id }, data: { status: JobStatus.QUEUED } });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.job.delete({ where: { id } });
  }
}
