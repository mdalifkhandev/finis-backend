import { IsIn } from 'class-validator';

export class UpdateMailboxStatusDto {
  @IsIn(['active', 'closed'])
  status!: 'active' | 'closed';
}
