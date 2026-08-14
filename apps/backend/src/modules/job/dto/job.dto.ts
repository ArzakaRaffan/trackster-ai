import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateJobDto {
  @IsString()
  @MinLength(5)
  idea: string;

  // 'trackster' (default) atau 'ai-trackster' (self-edit). BUKAN url bebas dari client
  // -- backend yang resolve key ini ke url env yang sesuai, biar nggak bisa disuruh
  // clone/push ke repo sembarangan.
  @IsOptional()
  @IsIn(['trackster', 'ai-trackster'])
  targetRepoKey?: 'trackster' | 'ai-trackster';
}

export class UpdatePlanDto {
  @IsString()
  @MinLength(10)
  plan: string;
}
