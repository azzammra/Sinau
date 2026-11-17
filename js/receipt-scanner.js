// ============================================================================
// js/receipt-scanner.js — Local OCR Preprocessor, Parser & Offline Initializer
// ============================================================================
const createSvgReceiptDataUri = (merchant, dateStr, items, total) => {
      const itemLines = items
        .map(
          (it, idx) =>
            `<text x="20" y="${130 + idx * 24}" font-family="monospace" font-size="11" fill="#1e293b">${escapeHtml(it.name.slice(0, 18))} (${it.qty}x)</text>
             <text x="260" y="${130 + idx * 24}" font-family="monospace" font-size="11" fill="#1e293b" text-anchor="end">${new Intl.NumberFormat('id-ID').format(it.qty * it.price)}</text>`
        )
        .join('');
      const height = 190 + items.length * 24;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="${height}" viewBox="0 0 280 ${height}">
        <rect width="100%" height="100%" fill="#fffbeb" rx="8"/>
        <rect x="8" y="8" width="264" height="${height - 16}" fill="none" stroke="#cbd5e1" stroke-dasharray="4 4" rx="4"/>
        <text x="140" y="36" font-family="monospace" font-weight="bold" font-size="14" fill="#0f172a" text-anchor="middle">${escapeHtml(merchant)}</text>
        <text x="140" y="54" font-family="monospace" font-size="10" fill="#64748b" text-anchor="middle">STRUK PEMBAYARAN TUNAI / QRIS</text>
        <text x="20" y="80" font-family="monospace" font-size="10" fill="#475569">Tgl: ${escapeHtml(dateStr)}</text>
        <line x1="20" y1="95" x2="260" y2="95" stroke="#94a3b8" stroke-dasharray="3 3"/>
        ${itemLines}
        <line x1="20" y1="${135 + items.length * 24}" x2="260" y2="${135 + items.length * 24}" stroke="#0f172a"/>
        <text x="20" y="${158 + items.length * 24}" font-family="monospace" font-weight="bold" font-size="12" fill="#0f172a">TOTAL IDR</text>
        <text x="260" y="${158 + items.length * 24}" font-family="monospace" font-weight="bold" font-size="12" fill="#059669" text-anchor="end">Rp ${new Intl.NumberFormat('id-ID').format(total)}</text>
      </svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    };

    const renderReceiptTextToPngDataUrl = (rawLines) => {
      const canvas = document.createElement('canvas');
      const width = 520;
      const lineHeight = 26;
      const padding = 32;
      const height = Math.max(360, padding * 2 + rawLines.length * lineHeight + 20);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, width - 20, height - 20);
      ctx.fillStyle = '#0f172a';
      ctx.textBaseline = 'top';
      rawLines.forEach((line, idx) => {
        const y = padding + idx * lineHeight;
        ctx.font = idx === 0 ? 'bold 18px monospace' : /TOTAL|TAGIHAN|BAYAR/i.test(line) ? 'bold 16px monospace' : '15px monospace';
        ctx.fillText(line, padding, y);
      });
      return canvas.toDataURL('image/png');
    };

    const preprocessReceiptImage = (sourceDataUrl, options) => {
      return new Promise((resolve) => {
        if (!sourceDataUrl) {
          resolve(sourceDataUrl);
          return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const rotation = Number(options?.rotation || 0);
            const skewDeg = Number(options?.skew || 0);
            const cropMargin = options?.autoCrop ? 0.04 : 0;
            const contrastLevel = Number(options?.contrast || 25);
            const grayscale = options?.grayscale !== false;
            const denoise = Boolean(options?.denoise);

            const srcX = Math.round(img.width * cropMargin);
            const srcY = Math.round(img.height * cropMargin);
            const srcW = Math.max(32, img.width - srcX * 2);
            const srcH = Math.max(32, img.height - srcY * 2);

            const scale = srcW < 500 ? 600 / srcW : srcW > 1400 ? 1400 / srcW : 1;
            const targetW = Math.round(srcW * scale);
            const targetH = Math.round(srcH * scale);

            const swapDims = rotation === 90 || rotation === 270;
            const canvas = document.createElement('canvas');
            canvas.width = swapDims ? targetH : targetW;
            canvas.height = swapDims ? targetW : targetH;

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(((rotation + skewDeg) * Math.PI) / 180);
            ctx.drawImage(img, srcX, srcY, srcW, srcH, -targetW / 2, -targetH / 2, targetW, targetH);
            ctx.restore();

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const factor = (259 * (contrastLevel + 255)) / (255 * (259 - contrastLevel));

            for (let i = 0; i < data.length; i += 4) {
              let r = data[i];
              let g = data[i + 1];
              let b = data[i + 2];
              if (grayscale) {
                const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                r = lum; g = lum; b = lum;
              }
              data[i] = Math.min(255, Math.max(0, Math.round(factor * (r - 128) + 128)));
              data[i + 1] = Math.min(255, Math.max(0, Math.round(factor * (g - 128) + 128)));
              data[i + 2] = Math.min(255, Math.max(0, Math.round(factor * (b - 128) + 128)));
            }

            if (denoise && grayscale) {
              const copy = new Uint8ClampedArray(data);
              const w = canvas.width;
              const h = canvas.height;
              for (let y = 1; y < h - 1; y += 1) {
                for (let x = 1; x < w - 1; x += 1) {
                  const idx = (y * w + x) * 4;
                  const center = copy[idx];
                  const avgNeighbors =
                    (copy[((y - 1) * w + x) * 4] +
                      copy[((y + 1) * w + x) * 4] +
                      copy[(y * w + (x - 1)) * 4] +
                      copy[(y * w + (x + 1)) * 4]) >> 2;
                  if (Math.abs(center - avgNeighbors) > 110) {
                    data[idx] = avgNeighbors;
                    data[idx + 1] = avgNeighbors;
                    data[idx + 2] = avgNeighbors;
                  }
                }
              }
            }

            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } catch {
            resolve(sourceDataUrl);
          }
        };
        img.onerror = () => resolve(sourceDataUrl);
        img.src = sourceDataUrl;
      });
    };

    const parseRupiahToken = (tokenStr) => {
      if (!tokenStr) return null;
      let s = String(tokenStr).trim();
      if (/^(?:\+62|08\d{6,}|02\d{1,2}-\d{5,}|\d{2}[/-]\d{2}[/-]\d{2,4})$/.test(s)) return null;
      s = s.replace(/^[Rr][Pp]\.?\s*/, '').replace(/[,-]+$/, '').replace(/[.,]00$/, '');
      if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
        const val = parseInt(s.replace(/[.,]/g, ''), 10);
        return val >= 100 && val <= 100000000 ? val : null;
      }
      if (/^\d{3,7}$/.test(s)) {
        const val = parseInt(s, 10);
        return val >= 500 && val <= 50000000 ? val : null;
      }
      return null;
    };

    const extractLineAmount = (line) => {
      if (/(?:TELP|TLP|HP|WA|NPWP|NO\.?\s*TRX|NO\.?\s*BON|NO\.?\s*STRUK|KASIR|MEMBER|POINT)/i.test(line)) {
        return null;
      }
      const matches = line.match(/(?:Rp\.?\s*)?\d{1,3}(?:[.,]\d{3})+(?:[.,]00|,-)?|\b\d{3,7}\b/g);
      if (!matches || matches.length === 0) return null;
      for (let i = matches.length - 1; i >= 0; i -= 1) {
        const candidate = parseRupiahToken(matches[i]);
        if (candidate !== null) return candidate;
      }
      return null;
    };

    const parseReceiptOcrText = (rawText, fallbackMonth = CURRENT_REAL_MONTH) => {
      const cleanText = String(rawText || '').replace(/\r/g, '');
      const lines = cleanText.split('\n').map((l) => l.trim()).filter(Boolean);
      const warnings = [];

      let merchant = '';
      for (let i = 0; i < Math.min(5, lines.length); i += 1) {
        const l = lines[i];
        if (l.length >= 3 && !/^(?:STRUK|NOTA|WELCOME|SELAMAT\s+DATANG|JL\.|JALAN|TELP|TLP|NPWP|\d+[-/]\d+)/i.test(l)) {
          merchant = l.replace(/[^a-zA-Z0-9\s.&'-]/g, '').trim();
          if (merchant.length >= 3) break;
        }
      }
      if (!merchant) {
        merchant = 'Merchant Struk (Perlu Konfirmasi)';
        warnings.push('Nama toko/merchant tidak terbaca jelas, mohon periksa kembali.');
      }

      let extractedDate = '';
      let extractedTime = '';
      const monthNameMap = {
        jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', may: '05', jun: '06',
        jul: '07', agu: '08', aug: '08', sep: '09', okt: '10', oct: '10', nov: '11', des: '12', dec: '12'
      };

      for (const line of lines) {
        if (!extractedTime) {
          const timeMatch = line.match(/\b([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b/);
          if (timeMatch) extractedTime = `${timeMatch[1]}:${timeMatch[2]}`;
        }
        const isoMatch = line.match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
        if (isoMatch) {
          extractedDate = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
          break;
        }
        const dmyMatch = line.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2}|\d{2})\b/);
        if (dmyMatch) {
          const d = String(dmyMatch[1]).padStart(2, '0');
          const m = String(dmyMatch[2]).padStart(2, '0');
          const y = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
          extractedDate = `${y}-${m}-${d}`;
          break;
        }
        const textDateMatch = line.match(/\b(0?[1-9]|[12]\d|3[01])\s+(Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Agu|Aug|Sep|Okt|Oct|Nov|Des|Dec)[a-z]*\s+(20\d{2})\b/i);
        if (textDateMatch) {
          const d = String(textDateMatch[1]).padStart(2, '0');
          const m = monthNameMap[textDateMatch[2].slice(0, 3).toLowerCase()] || '11';
          extractedDate = `${textDateMatch[3]}-${m}-${d}`;
          break;
        }
      }

      if (!extractedDate) {
        extractedDate = `${fallbackMonth}-16`;
        warnings.push('Tanggal transaksi tidak terdeteksi pada struk; menggunakan tanggal default.');
      }

      let paymentMethod = 'Tunai';
      for (const line of lines) {
        if (/\bQRIS\b/i.test(line)) { paymentMethod = 'QRIS'; break; }
        if (/\b(?:GOPAY|OVO|DANA|SHOPEEPAY|LINKAJA)\b/i.test(line)) {
          const m = line.match(/\b(GOPAY|OVO|DANA|SHOPEEPAY|LINKAJA)\b/i);
          paymentMethod = m ? m[1].toUpperCase() : 'E-Wallet';
          break;
        }
        if (/\b(?:DEBIT|KARTU|BCA|BRI|MANDIRI|BNI|TRANSFER)\b/i.test(line)) {
          paymentMethod = 'Transfer / Debit';
          break;
        }
      }
      const suggestedAccount =
        paymentMethod === 'QRIS' || paymentMethod === 'E-Wallet' || /GOPAY|OVO|DANA|SHOPEEPAY/.test(paymentMethod)
          ? 'ewallet'
          : paymentMethod === 'Transfer / Debit'
          ? 'bank'
          : 'tunai';

      let grandTotal = null;
      let subtotal = 0;
      let tax = 0;
      let discount = 0;
      const items = [];

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const upper = line.toUpperCase();
        if (
          /^[-=*_.\s]+$/.test(line) ||
          /(?:TERIMA\s*KASIH|THANK\s*YOU|BARANG\s*YANG|LAYANAN\s*KONSUMEN|CALL\s*CENTER|NPWP|JL\.|SURAKARTA|KLATEN|YOGYAKARTA)/i.test(line)
        ) {
          continue;
        }
        if (/\b(?:SUB\s*TOTAL|SUBTOTAL|HARGA\s*JUAL)\b/i.test(upper)) {
          const val = extractLineAmount(line);
          if (val !== null) subtotal = val;
          continue;
        }
        if (/\b(?:PPN|PAJAK|TAX|PB1|SERVICE|BIAYA\s*LAYANAN)\b/i.test(upper)) {
          const val = extractLineAmount(line);
          if (val !== null) tax += val;
          continue;
        }
        if (/\b(?:DISKON|DISC|POTONGAN|ANDA\s*HEMAT|VOUCHER)\b/i.test(upper)) {
          const val = extractLineAmount(line);
          if (val !== null) discount += val;
          continue;
        }
        if (/\b(?:KEMBALI|CHANGE|KEMBALIAN)\b/i.test(upper)) continue;
        if (/\b(?:GRAND\s*TOTAL|TOTAL\s*BAYAR|TOTAL\s*BELANJA|TOTAL\s*TAGIHAN|TOTAL\s*IDR|TOTAL)\b/i.test(upper)) {
          const val = extractLineAmount(line);
          if (val !== null) grandTotal = val;
          continue;
        }
        if (/\b(?:TUNAI|CASH|BAYAR|QRIS)\b/i.test(upper) && grandTotal !== null) continue;

        const inlineQtyMatch = line.match(/^(.+?)\s+(\d{1,3})\s*[xX@]\s*(?:Rp\.?\s*)?([\d.,]+)\s+(?:Rp\.?\s*)?([\d.,]+)$/);
        if (inlineQtyMatch) {
          const rawName = inlineQtyMatch[1].replace(/^[\d.\s-]+/, '').trim();
          const qty = Math.max(1, parseInt(inlineQtyMatch[2], 10) || 1);
          const unitPrice = parseRupiahToken(inlineQtyMatch[3]);
          const lineTotal = parseRupiahToken(inlineQtyMatch[4]);
          const finalPrice = unitPrice || (lineTotal ? Math.round(lineTotal / qty) : 0);
          if (rawName.length >= 2 && finalPrice > 0) {
            items.push({ id: `ocr_item_${i}_${Date.now()}`, name: rawName, qty, price: finalPrice });
            continue;
          }
        }
      }

      const computedItemsSum = items.reduce((acc, it) => acc + toIntIDR(it.qty) * toIntIDR(it.price), 0);
      if (!subtotal && computedItemsSum > 0) subtotal = computedItemsSum;

      let finalAmount = grandTotal;
      if (finalAmount === null || finalAmount <= 0) {
        if (subtotal > 0) {
          finalAmount = Math.max(0, subtotal + tax - discount);
          warnings.push('Label TOTAL utama tidak terbaca jelas; total dihitung dari Subtotal + Pajak - Diskon.');
        } else if (computedItemsSum > 0) {
          finalAmount = computedItemsSum;
        } else {
          finalAmount = 0;
          warnings.push('Nominal total pembayaran belum terdeteksi dari gambar struk. Mohon isi secara manual.');
        }
      }

      if (items.length === 0 && finalAmount > 0) {
        items.push({ id: `ocr_item_fb_${Date.now()}`, name: `Pembelian di ${merchant}`, qty: 1, price: finalAmount });
      }

      const combinedLower = `${merchant} ${items.map((x) => x.name).join(' ')}`.toLowerCase();
      let category = 'kebutuhan';
      if (/(?:warung|makan|nasi|ayam|soto|kantin|kopi|cafe|kafe|resto|bakso|mie|es\s+teh|jeruk)/.test(combinedLower)) {
        category = 'makanan';
      } else if (/(?:spbu|pertamina|pertamax|pertalite|bensin|parkir|gojek|grab)/.test(combinedLower)) {
        category = 'transportasi';
      } else if (/(?:fotokopi|copy|print|jilid|buku|kertas|pulpen|kampus|alat\s+tulis)/.test(combinedLower)) {
        category = 'akademik';
      } else if (/(?:listrik|pln|kuota|pulsa|indosat|telkomsel|wifi|kos)/.test(combinedLower)) {
        category = 'tagihan';
      }

      return {
        merchant,
        date: extractedDate,
        time: extractedTime || '12:00',
        category,
        account: suggestedAccount,
        paymentMethod,
        subtotal,
        tax,
        discount,
        amount: finalAmount,
        items,
        rawOcrText: cleanText,
        warnings
      };
    };

    const OCR_PRESET_TEMPLATES = [
      {
        id: 'preset_indomaret',
        label: 'Struk Minimarket (Indomaret)',
        merchant: 'INDOMARET SONDAKAN SURAKARTA',
        date: '2026-11-16',
        category: 'kebutuhan',
        rawReceiptLines: [
          'INDOMARET SONDAKAN SURAKARTA',
          'JL. KH SAMANHUDI NO. 88 SOLO',
          'TELP: 0271-712345 NPWP: 01.234.567.8',
          '16/11/2026 14:22 KASIR: RINA',
          'NO. TRX: 081299887766',
          '--------------------------------',
          'AQUA AIR MINERAL 600ML  2 x 4.000   8.000',
          'MIE SEDAAP GORENG 5PCS  1 x 15.500  15.500',
          'KAPAL API SPECIAL 160G  1 x 14.500  14.500',
          'PASEO TISU WAJAH 250S   1 x 13.500  13.500',
          '--------------------------------',
          'SUBTOTAL                     51.500',
          'DISKON PROMO                  4.000',
          'PPN INCL                          0',
          'GRAND TOTAL               Rp 47.500',
          'PEMBAYARAN QRIS              47.500',
          'KEMBALI                           0'
        ]
      },
      {
        id: 'preset_kantin',
        label: 'Nota Warung Makan / Kantin',
        merchant: 'WARUNG MAKAN BU DARMI',
        date: '2026-11-16',
        category: 'makanan',
        rawReceiptLines: [
          'WARUNG MAKAN BU DARMI',
          'DEKAT KAMPUS KENTINGAN SOLO',
          'WA: 085725009911',
          '16-11-2026 12:45',
          '--------------------------------',
          'NASI AYAM GEPREK        1 x 16.000  16.000',
          'TAHU TEMPE GORENG       2 x 2.500    5.000',
          'ES JERUK PERAS MURNI    1 x 6.000    6.000',
          '--------------------------------',
          'SUBTOTAL                     27.000',
          'TOTAL BAYAR               Rp 27.000',
          'TUNAI                        30.000',
          'KEMBALI                       3.000'
        ]
      },
      {
        id: 'preset_fotokopi',
        label: 'Nota Fotokopi & Alat Tulis',
        merchant: 'FOTOKOPI & PERCETAKAN KAMPUS JAYA',
        date: '2026-11-16',
        category: 'akademik',
        rawReceiptLines: [
          'FOTOKOPI & PERCETAKAN KAMPUS JAYA',
          '16 Nov 2026 09:30',
          'NO BON: 20261116009',
          '--------------------------------',
          'PRINT HVS A4 HITAM      45 x 500    22.500',
          'JILID LAKBAN MIKA        1 x 5.000   5.000',
          'PULPEN FASTER C6         2 x 3.500   7.000',
          '--------------------------------',
          'SUBTOTAL                     34.500',
          'TOTAL BELANJA             Rp 34.500',
          'METODE: TUNAI'
        ]
      },
      {
        id: 'preset_spbu',
        label: 'Struk SPBU Pertamina',
        merchant: 'SPBU PERTAMINA 44.571.08',
        date: '2026-11-16',
        category: 'transportasi',
        rawReceiptLines: [
          'SPBU PERTAMINA 44.571.08',
          'SURAKARTA JAWA TENGAH',
          '2026-11-16 07:15',
          'NO. TRANS: 9901823',
          '--------------------------------',
          'PERTAMAX RON 92          1 x 40.000  40.000',
          '--------------------------------',
          'SUBTOTAL                     40.000',
          'TOTAL BAYAR               Rp 40.000',
          'PEMBAYARAN QRIS'
        ]
      }
    ];

    // =========================================================================
    // 4. INITIAL DATA & DUAL STORAGE ENGINE (INDEXEDDB + LOCALSTORAGE MIRROR)
    // =========================================================================
    const INITIAL_SETTINGS = {
      id: 'app_settings',
      startingBalance: 750000,
      activeMonth: '2026-11',
      activeWeek: 3,
      weekStartDay: 'monday',
      theme: 'dark',
      schemaVersion: 2
    };

    const INITIAL_BUDGETS = [
      {
        id: '2026-11',
        month: '2026-11',
        monthlyAllowance: 1800000,
        monthlySpendingBudget: 1500000,
        weeklyAllocations: { 1: 50000, 2: 350000, 3: 350000, 4: 350000, 5: 350000, 6: 50000 },
        categoryBudgets: {
          makanan: 650000, transportasi: 200000, akademik: 250000, tagihan: 200000,
          kebutuhan: 100000, hiburan: 50000, kesehatan: 30000, lainnya_keluar: 20000
        }
      },
      {
        id: '2026-12',
        month: '2026-12',
        monthlyAllowance: 1800000,
        monthlySpendingBudget: 1500000,
        weeklyAllocations: { 1: 200000, 2: 350000, 3: 350000, 4: 350000, 5: 250000 },
        categoryBudgets: {
          makanan: 650000, transportasi: 200000, akademik: 250000, tagihan: 200000,
          kebutuhan: 100000, hiburan: 50000, kesehatan: 30000, lainnya_keluar: 20000
        }
      }
    ];

    const INITIAL_RECEIPTS = [
      {
        id: 'rcpt_initial_1',
        merchant: 'Indomaret Point Kampus',
        date: '2026-11-14',
        time: '19:15',
        amount: 46500,
        subtotal: 46500,
        tax: 0,
        discount: 0,
        paymentMethod: 'QRIS',
        category: 'kebutuhan',
        items: [
          { id: 'i1', name: 'Susu Ultra Cokelat 250ml', qty: 2, price: 7500 },
          { id: 'i2', name: 'Roti Tawar Gandum', qty: 1, price: 16500 },
          { id: 'i3', name: 'Sabun Cuci Muka 50g', qty: 1, price: 15000 }
        ],
        imageData: createSvgReceiptDataUri(
          'Indomaret Point Kampus',
          '2026-11-14',
          [
            { name: 'Susu Ultra Cokelat', qty: 2, price: 7500 },
            { name: 'Roti Tawar Gandum', qty: 1, price: 16500 },
            { name: 'Sabun Cuci Muka', qty: 1, price: 15000 }
          ],
          46500
        ),
        rawOcrText: 'INDOMARET POINT KAMPUS\n14/11/2026 19:15\nSusu Ultra Cokelat 250ml 2 x 7.500 15.000\nRoti Tawar Gandum 1 x 16.500 16.500\nSabun Cuci Muka 50g 1 x 15.000 15.000\nSUBTOTAL 46.500\nGRAND TOTAL Rp 46.500',
        ocrConfidence: 96,
        ocrMode: 'Mesin OCR Lokal Tesseract.js'
      }
    ];

    const INITIAL_TRANSACTIONS = [
      { id: 'tx_101', title: 'Uang Saku Bulanan November', type: 'income', category: 'uang_saku', amount: 1800000, date: '2026-11-01', account: 'bank', toAccount: null, note: 'Kiriman uang saku awal bulan November', receiptId: null },
      { id: 'tx_102', title: 'Paket Internet & Kuota Belajar', type: 'expense', category: 'tagihan', amount: 95000, date: '2026-11-02', account: 'ewallet', toAccount: null, note: 'Paket data bulanan 50GB', receiptId: null },
      { id: 'tx_103', title: 'Makan Siang & Es Teh di Kantin', type: 'expense', category: 'makanan', amount: 42000, date: '2026-11-04', account: 'tunai', toAccount: null, note: 'Soto ayam + tempe mendoan', receiptId: null },
      { id: 'tx_104', title: 'Fotokopi Modul Fisika & Alat Tulis', type: 'expense', category: 'akademik', amount: 68000, date: '2026-11-06', account: 'tunai', toAccount: null, note: 'Jilid spiral latihan soal TKA & pena gel', receiptId: null },
      { id: 'tx_105', title: 'Isi Bensin Pertamax Motor', type: 'expense', category: 'transportasi', amount: 55000, date: '2026-11-08', account: 'ewallet', toAccount: null, note: 'SPBU perjalanan les & sekolah', receiptId: null },
      { id: 'tx_106', title: 'Nasi Ayam Bakar & Sayur Warteg', type: 'expense', category: 'makanan', amount: 85000, date: '2026-11-10', account: 'tunai', toAccount: null, note: 'Rekap makan harian pekan kedua', receiptId: null },
      { id: 'tx_107', title: 'Honor Freelance Desain & Web', type: 'income', category: 'freelance', amount: 350000, date: '2026-11-12', account: 'bank', toAccount: null, note: 'Proyek pembuatan landing page klien lokal', receiptId: null },
      { id: 'tx_108', title: 'Tarik Tunai / Top-up E-Wallet', type: 'transfer', category: 'transfer_internal', amount: 200000, date: '2026-11-13', account: 'bank', toAccount: 'ewallet', note: 'Pindah saldo dari Rekening Bank ke E-Wallet (Non-Beban)', receiptId: null },
      { id: 'tx_109', title: 'Belanja Indomaret Point Kampus', type: 'expense', category: 'kebutuhan', amount: 46500, date: '2026-11-14', account: 'ewallet', toAccount: null, note: 'Susu Ultra, Roti Gandum, Sabun Cuci Muka (Dari Pindai Struk)', receiptId: 'rcpt_initial_1' },
      { id: 'tx_110', title: 'Beli Buku Latihan Soal & Kertas A4', type: 'expense', category: 'akademik', amount: 110000, date: '2026-11-15', account: 'ewallet', toAccount: null, note: 'Persiapan ujian akhir semester', receiptId: null },
      { id: 'tx_111', title: 'Sarapan Bubur & Makan Malam Pecel', type: 'expense', category: 'makanan', amount: 58000, date: '2026-11-16', account: 'tunai', toAccount: null, note: 'Pengeluaran makan hari ini', receiptId: null }
    ];

    