import { Test, TestingModule } from '@nestjs/testing';
import { PublicShareService } from './public-share.service';

describe('PublicShareService', () => {
  let service: PublicShareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PublicShareService],
    }).compile();

    service = module.get<PublicShareService>(PublicShareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
