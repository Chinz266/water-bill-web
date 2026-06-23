import { TestBed } from '@angular/core/testing';

import { MeterReadingService } from './meter-reading.service';

describe('MeterReadingService', () => {
  let service: MeterReadingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MeterReadingService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
