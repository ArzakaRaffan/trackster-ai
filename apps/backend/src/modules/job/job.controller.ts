import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JobService } from './job.service';
import { CreateJobDto, UpdatePlanDto } from './dto/job.dto';
import { AuthGuard } from '../../common/auth.guard';
import { AgentSecretGuard } from '../../common/agent-secret.guard';

@UseGuards(AuthGuard)
@Controller('jobs')
export class JobController {
  constructor(private jobService: JobService) {}

  // Create job = trigger agent beneran (walau lewat tahap plan dulu) -> butuh password kedua
  @UseGuards(AgentSecretGuard)
  @Post()
  async create(@Body() dto: CreateJobDto) {
    return this.jobService.create(dto.idea, dto.targetRepoKey);
  }

  // Lihat daftar/detail job cukup login biasa, nggak perlu password kedua
  @Get()
  async findAll() {
    return this.jobService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.jobService.findOne(id);
  }

  @UseGuards(AgentSecretGuard)
  @Put(':id/plan')
  async updatePlan(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlanDto) {
    return this.jobService.updatePlan(id, dto.plan);
  }

  // Approve = ini yang paling kritis, beneran masuk antrian dieksekusi -> password kedua wajib
  @UseGuards(AgentSecretGuard)
  @Post(':id/approve')
  async approve(@Param('id', ParseIntPipe) id: number) {
    return this.jobService.approve(id);
  }

  @UseGuards(AgentSecretGuard)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.jobService.remove(id);
  }
}
