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

  // 'manual' (default): approve + review + merge manual seperti biasa.
  // 'auto': auto-approve begitu plan jadi, auto-merge ke main kalau lolos review Claude
  // DAN nggak nyentuh file sensitif (lihat worker/poll-and-run.js).
  @IsOptional()
  @IsIn(['manual', 'auto'])
  mode?: 'manual' | 'auto';
}

export class UpdatePlanDto {
  @IsString()
  @MinLength(10)
  plan: string;
}
