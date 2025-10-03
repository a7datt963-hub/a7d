import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// إعداد Google Sheets
const SPREADSHEET_ID = "1TnvbnjNPQ1eOmjv2D5nMgGRGKlZExK63RKmaOccK9Vo"; 
// مثال: https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit

const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");

const serviceAccountAuth = new JWT({
  email: SERVICE_ACCOUNT_EMAIL,
  key: SERVICE_ACCOUNT_KEY,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

app.post("/submit", async (req, res) => {
  try {
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0]; // أول شيت

    const { type, product, code, supplier, quantity, unitPrice, total, note } = req.body;
    const now = new Date();

    await sheet.addRow({
      النوع: type,
      المنتج: product,
      "رمز المنتج": code,
      "اسم المورد": supplier,
      الكمية: quantity,
      "سعر الوحدة": unitPrice || "",
      الإجمالي: total || "",
      ملاحظة: note || "",
      التاريخ: now.toLocaleDateString("ar-EG"),
      الوقت: now.toLocaleTimeString("ar-EG"),
    });

    res.json({ success: true, message: "تم الحفظ في Google Sheets ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "حدث خطأ أثناء الحفظ" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
