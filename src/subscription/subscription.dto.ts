import { IsEmail, IsIn, IsString } from 'class-validator';

export class VerifyCheckoutDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsString()
  planId!: string;

  @IsIn(['monthly', 'yearly'])
  interval!: 'monthly' | 'yearly';
}
