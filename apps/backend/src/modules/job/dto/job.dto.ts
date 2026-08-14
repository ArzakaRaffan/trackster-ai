import { IsString, MinLength } from 'class-validator';

export class CreateJobDto {
  @IsString()
  @MinLength(5)
  idea: string;
}

export class UpdatePlanDto {
  @IsString()
  @MinLength(10)
  plan: string;
}
