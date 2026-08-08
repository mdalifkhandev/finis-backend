import { Test, TestingModule } from '@nestjs/testing';
import { PublicShareController } from './public-share.controller';

describe('PublicShareController', () => {
  let controller: PublicShareController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicShareController],
    }).compile();

    controller = module.get<PublicShareController>(PublicShareController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
