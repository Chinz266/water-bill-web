import { ApplicationRef, Injectable, inject, signal } from '@angular/core';

/**
 * ศูนย์กลางของ "บิลที่พิมพ์ออกกระดาษ"
 * ใช้ร่วมกันทั้งหน้าประวัติบิลและหน้าลูกบ้าน เอกสารจะได้หน้าตาเหมือนกันทุกที่
 */
@Injectable({ providedIn: 'root' })
export class BillPrintService {
  private appRef = inject(ApplicationRef);

  // ==========================================
  // 🌟 แก้ชื่อหน่วยงาน / ที่อยู่หมู่บ้านของคุณตรงนี้ได้เลย
  // ==========================================
  readonly orgName = 'ที่ทำการประปาหมู่บ้าน';
  readonly orgAddress = 'หมู่ที่ .... ตำบล ............ อำเภอ ............ จังหวัด ............';
  readonly orgPhone = 'โทร. ..............';

  // เอกสารที่กำลังจะพิมพ์ — ใช้ signal เพราะแอปเป็น zoneless
  readonly billToPrint = signal<any>(null);   // ใบเต็มหน้า A4 (ทีละใบ)
  readonly billsToPrint = signal<any[]>([]);  // สลิปหลายใบต่อแผ่น

  // ==========================================
  // ข้อความที่ใช้ร่วมกันทั้งหน้าเว็บและเอกสาร
  // ==========================================
  statusLabel(status: string): string {
    return status === 'Paid' ? 'ชำระแล้ว' : 'รอชำระเงิน';
  }

  ownerName(bill: any): string {
    const member = bill?.member;
    if (!member) return 'ไม่พบข้อมูลลูกบ้าน';
    return `${member.fname ?? ''} ${member.lname ?? ''}`.trim() || 'ไม่ระบุชื่อ';
  }

  private readonly thMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  // '07' + '2026' → 'กรกฎาคม 2569' (แสดงเป็น พ.ศ. ตามที่คนไทยใช้กัน)
  monthLabel(month: string | number, year: string | number): string {
    const m = Number(month);
    const y = Number(year);
    const name = this.thMonths[m - 1] ?? `เดือน ${month}`;
    const buddhistYear = y > 2400 ? y : y + 543;
    return `${name} ${buddhistYear}`;
  }

  // '2026-07-20' → '20 กรกฎาคม 2569'
  // ใช้แทน date pipe เพราะ pipe จะได้เดือนอังกฤษ (July) และปี ค.ศ. ซึ่งอ่านแปลกในเอกสารไทย
  dateLabel(value: string | Date | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return `${d.getDate()} ${this.thMonths[d.getMonth()]} ${d.getFullYear() + 543}`;
  }

  // กำหนดชำระ = วันที่ 1 ของเดือนถัดจากรอบบิล
  // (บิลรอบกรกฎาคม → ชำระภายใน 1 สิงหาคม) ทุกบ้านจึงมีกำหนดวันเดียวกันทั้งหมู่บ้าน
  dueDate(bill: any): Date | null {
    const month = Number(bill?.billing_month);
    const year = Number(bill?.billing_year);

    // เดือนใน JS เริ่มนับที่ 0 พอดีกับการบวกไปอีก 1 เดือน เช่น รอบ 07 → new Date(y, 7, 1) = 1 ส.ค.
    // และถ้าเป็นรอบเดือน 12 จะข้ามไปเป็น 1 ม.ค. ปีถัดไปให้เอง
    if (month >= 1 && month <= 12 && year > 0) {
      return new Date(year, month, 1);
    }

    // เผื่อบิลเก่าที่ไม่มีรอบเดือนติดมา ใช้วันที่ 1 ของเดือนถัดจากวันออกบิลแทน
    if (!bill?.create_date) return null;
    const d = new Date(bill.create_date);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }

  // ==========================================
  // แปลงจำนวนเงินเป็นตัวอักษรไทย เช่น 295 → "สองร้อยเก้าสิบห้าบาทถ้วน"
  // ==========================================
  private readonly thDigit = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  private readonly thPlace = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  bahtText(amount: number): string {
    const value = Number(amount);
    if (isNaN(value)) return '';

    const [bahtStr, satangStr] = value.toFixed(2).split('.');
    const baht = parseInt(bahtStr, 10);
    const satang = parseInt(satangStr, 10);

    let text = baht === 0 ? 'ศูนย์บาท' : this.readThaiInteger(baht) + 'บาท';
    text += satang === 0 ? 'ถ้วน' : this.readThaiInteger(satang) + 'สตางค์';
    return text;
  }

  private readThaiInteger(num: number): string {
    if (num === 0) return '';

    if (num >= 1000000) {
      const millions = Math.floor(num / 1000000);
      const rest = num % 1000000;
      return this.readThaiInteger(millions) + 'ล้าน' + (rest > 0 ? this.readThaiInteger(rest) : '');
    }

    const digits = num.toString().split('').map(Number);
    const len = digits.length;
    let text = '';

    for (let i = 0; i < len; i++) {
      const d = digits[i];
      const place = len - i - 1;
      if (d === 0) continue;

      if (place === 1 && d === 1) {
        text += 'สิบ';
      } else if (place === 1 && d === 2) {
        text += 'ยี่สิบ';
      } else if (place === 0 && d === 1 && len > 1) {
        text += 'เอ็ด';
      } else {
        text += this.thDigit[d] + this.thPlace[place];
      }
    }
    return text;
  }

  // ==========================================
  // สั่งพิมพ์ — ต้อง tick() ให้เอกสารขึ้น DOM ก่อน ไม่งั้นจะพิมพ์หน้าเปล่า
  // ==========================================
  printSingle(bill: any): void {
    if (typeof window === 'undefined' || !bill) return;

    this.billToPrint.set(bill);
    this.appRef.tick();

    this.printThenCleanup('bill-print', () => this.billToPrint.set(null));
  }

  printMany(bills: any[]): void {
    if (typeof window === 'undefined' || !bills?.length) return;

    this.billsToPrint.set(bills);
    this.appRef.tick();

    this.printThenCleanup('bills-print-all', () => this.billsToPrint.set([]));
  }

  /** กันเก็บกวาดซ้ำซ้อนเวลากดพิมพ์รัว ๆ */
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * สั่งพิมพ์แล้วค่อยล้างเอกสารทิ้ง "หลังจาก" พิมพ์เสร็จจริง
   *
   * ⚠️ ห้ามล้างต่อท้าย window.print() ตรง ๆ
   *    บนคอม window.print() จะค้างรอจนกว่าผู้ใช้จะปิดกล่องพิมพ์ ล้างต่อท้ายเลยไม่มีปัญหา
   *    แต่บนมือถือ (Chrome Android / Safari iOS) มัน "ไม่ค้างรอ" — คืนค่าทันที
   *    แล้วค่อยไปสร้างหน้าตัวอย่างทีหลัง บรรทัดล้างจึงลบเอกสารออกจาก DOM
   *    ตั้งแต่ก่อนหน้าตัวอย่างจะถูกวาด ผลคือได้กระดาษเปล่าหรือไม่ขึ้นอะไรเลย
   *
   *    จึงต้องรอ event afterprint แทน และมี timer สำรองเพราะ Safari บน iOS
   *    ไม่ได้ยิง afterprint ให้ทุกครั้ง (เอกสารถูกซ่อนอยู่แล้วบนจอ ค้างไว้ก่อนไม่เสียหาย)
   */
  private printThenCleanup(nodeId: string, cleanup: () => void): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);

    const done = () => {
      window.removeEventListener('afterprint', done);
      if (this.cleanupTimer) {
        clearTimeout(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      cleanup();
      this.appRef.tick();
    };

    window.addEventListener('afterprint', done);
    this.cleanupTimer = setTimeout(done, 60000);

    // พิมพ์จากเอกสารแยกก่อน ถ้าทำไม่ได้ค่อยถอยไปใช้วิธีเดิม
    if (!this.printInIsolatedFrame(nodeId)) {
      window.print();
    }
  }

  /**
   * พิมพ์จาก iframe ที่มีแต่เอกสารบิล
   *
   * วิธีเดิมคือสั่งพิมพ์หน้าเว็บทั้งหน้า แล้วใช้ @media print ซ่อนทุกอย่างทิ้งให้เหลือแต่บิล
   * ปัญหาคือบิลยังอยู่ใต้ <app-root> ของแอปจริง ถ้า ancestor ตัวไหนมี overflow / height
   * / position / transform ที่ตัดเนื้อหา เบราว์เซอร์มือถือจะพิมพ์ออกมาไม่ครบหรือได้กระดาษเปล่า
   * ไล่ปิดทีละสาเหตุไม่จบ เพราะเพิ่ม CSS ที่หน้าไหนก็พังใหม่ได้อีก
   *
   * ย้ายมาโคลนเฉพาะก้อนเอกสารไปวางใน iframe เปล่า ๆ ที่ไม่มี app shell เลย
   * แล้วสั่งพิมพ์ตัว iframe แทน — ไม่มี ancestor ให้มาตัดอะไรอีก
   * (ก๊อป <style>/<link> จาก head มาด้วย สไตล์ใบเสร็จใน styles.css จึงยังใช้ได้เหมือนเดิม
   *  ไม่ต้องเขียน CSS ซ้ำสองที่)
   */
  private printInIsolatedFrame(nodeId: string): boolean {
    const source = document.getElementById(nodeId);
    if (!source) return false;

    try {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      // ต้องมีขนาดจริง (ไม่ใช่ 0) ไม่งั้นบางเบราว์เซอร์ถือว่าไม่มีอะไรให้พิมพ์
      // ดันออกนอกจอแทนการ visibility:hidden — บางเบราว์เซอร์ไม่วาดสิ่งที่ถูกซ่อน แล้วพิมพ์ไม่ออก
      frame.style.cssText =
        'position:fixed;left:-9999px;top:0;width:210mm;height:297mm;border:0;';
      document.body.appendChild(frame);

      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) {
        frame.remove();
        return false;
      }

      doc.open();
      doc.write(
        `<!doctype html><html lang="th"><head><meta charset="utf-8">${document.head.innerHTML}</head><body>${source.outerHTML}</body></html>`,
      );
      doc.close();

      const fire = () => {
        try {
          win.focus();
          win.print();
        } catch {
          // iframe พิมพ์ไม่ได้ (เบราว์เซอร์เก่า/ถูกบล็อก) — ถอยไปพิมพ์ทั้งหน้าแทน
          window.print();
        }
        // ลบทิ้งช้าหน่อย เพราะบางเบราว์เซอร์ยังอ่าน iframe อยู่ตอนสร้างหน้าตัวอย่าง
        setTimeout(() => frame.remove(), 60000);
      };

      // รอให้ stylesheet ใน head โหลดเสร็จก่อน ไม่งั้นได้เอกสารที่ยังไม่มีสไตล์
      if (doc.readyState === 'complete') {
        setTimeout(fire, 50);
      } else {
        frame.onload = () => setTimeout(fire, 50);
      }
      return true;
    } catch {
      // เบราว์เซอร์บล็อก iframe หรือเขียนเอกสารไม่ได้ — ให้ผู้เรียกถอยไปใช้ window.print()
      return false;
    }
  }
}
