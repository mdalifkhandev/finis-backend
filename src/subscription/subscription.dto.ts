import { IsEmail, IsIn, IsString, IsUUID } from 'class-validator';

export class VerifyCheckoutDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsUUID()
  planId!: string;

  @IsIn(['monthly', 'yearly'])
  interval!: 'monthly' | 'yearly';
}