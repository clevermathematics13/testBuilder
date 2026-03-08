# Quick Start Guide - Exam Management System

## 🚀 Getting Started in 5 Minutes

### Step 1: Configure Your Root Folder (2 minutes)

1. Open [ExamUI_Backend.js](ExamUI_Backend.js#L15)
2. Find the `_getExamSystemConfig()` function
3. Replace `YOUR_ROOT_FOLDER_ID_HERE` with your actual Google Drive folder ID

**How to get your folder ID:**
- Open your root folder in Google Drive
- Look at the URL: `https://drive.google.com/drive/folders/YOUR_FOLDER_ID_HERE`
- Copy the ID from the URL

Example:
```javascript
ROOT_FOLDER_ID: "1GDGql-mIeH2YoD1OfnFa0UhxUdaXsY4D",
```

### Step 2: Test the Setup (1 minute)

In Apps Script editor:
1. Select `testExamSystem` function from dropdown
2. Click **Run** (▶️)
3. Check Execution log - should show: `=== All Tests Passed ===`

If you see errors, double-check your folder ID and permissions.

### Step 3: Deploy the Web App (2 minutes)

1. Click **Deploy** → **New deployment**
2. Type: **Web app**
3. Description: "Exam Management System"
4. Execute as: **Me**
5. Who has access: **Only myself**
6. Click **Deploy**
7. **Copy the Web App URL** - you'll use this to access the UI

### Step 4: Open the UI

Visit your Web App URL, you'll see:

```
🎓 Exam Management System
```

With dropdowns for:
- ☑️ Include Past Classes
- Class selection
- Exam selection

And three action buttons:
- 📋 Markscheme Atomization
- 📄 Student Work OCR
- ✅ Student Response Grader

---

## 📁 Required Folder Structure

Make sure your folders follow this pattern:

```
Your Root Folder/
├── IB Math HL 2025-2026/          ← Class folder (current)
│   ├── Midterm October 2025/      ← Exam folder
│   │   ├── markscheme.docx        ← Must contain "markscheme" or "ms"
│   │   ├── exam.pdf
│   │   └── Student Work/
│   │       └── Individual PDFs/   ← Student work goes here
│   │           ├── Smith_John_12345_Q1.pdf
│   │           ├── Doe_Jane_12346_Q1.pdf
│   │           └── ...
│   └── Final Exam December 2025/
└── IB Math HL 2024-2025/          ← Past class
    └── ...
```

---

## 🎯 Your First Workflow

### Atomize a Markscheme

1. Select your class from dropdown
2. Select an exam
3. Click **📋 Markscheme Atomization**
4. Wait for "✅ Atomization complete!" in the log
5. Check the output folder (created automatically in Drive)

**What it does:**
- Finds the markscheme Google Doc
- Extracts all marking points via OCR
- Structures them into JSON format
- Saves to `MSA_Output/[Question]/markscheme_points_best.json`

### Process Student Work

1. Make sure you have PDFs in `Student Work/Individual PDFs/`
2. Click **📄 Student Work OCR**
3. Watch the log for progress
4. If confidence is low, you'll see a review modal:
   - Original image shown on top
   - OCR text in editable textarea below
   - Fix any errors
   - Click "Approve & Continue"
5. Repeat for all flagged pages
6. When done: "✅ OCR pipeline complete!"

**What it does:**
- Scans all student PDFs
- Extracts text using Mathpix OCR
- Calculates confidence scores
- Flags low-confidence results for your review
- Saves corrected text to individual folders

### Grade Students

1. After atomization AND OCR are complete
2. Click **✅ Student Response Grader**
3. Wait for processing
4. Check log for results:
   - Individual student scores
   - Class average
   - Detailed breakdown

**What it does:**
- Loads atomized markscheme
- Loads OCR'd student responses
- Matches student work to marking criteria
- Assigns points based on rubric
- Generates detailed reports

---

## 🔧 Common Customizations

### Change Confidence Threshold

Lower threshold = less human review needed (but less accurate)

Edit [StudentWorkOCR.js](StudentWorkOCR.js#L14):
```javascript
confidenceThreshold: 0.75,  // Default: 0.85
```

### Adjust Student Name Extraction

Your files named differently?

Edit [StudentWorkOCR.js](StudentWorkOCR.js#L379) `extractStudentInfo()`:
```javascript
// Custom parsing for: "12345_Smith_John.pdf"
if (parts.length >= 3) {
  id = parts[0];
  name = `${parts[1]}, ${parts[2]}`;
}
```

### Add Custom Folder Keywords

Edit [ExamUI_Backend.js](ExamUI_Backend.js#L22):
```javascript
CURRENT_CLASS_KEYWORDS: ["2025", "Active", "Spring"],
PAST_CLASS_KEYWORDS: ["2024", "2023", "Archived"],
```

---

## 🐛 Troubleshooting

### "Class folder not found"
**Fix:** Update `ROOT_FOLDER_ID` in `ExamUI_Backend.js`

### "Markscheme not found"
**Fix:** Rename your file to include "markscheme" or "ms"

### "OCR failed"
**Causes:**
- Mathpix API not configured (check [MSA_Config.js](MSA_Config.js))
- Image quality too low
- File permissions issue

**Fix:**
- Verify Mathpix credentials
- Ensure images are min 150 DPI
- Check file can be accessed

### "Needs Review" shows many pages
**This is normal!** Handwriting is hard to OCR.

**To reduce:**
- Improve scan quality
- Use higher resolution (300 DPI+)
- Ensure good lighting/contrast
- Use typed submissions when possible

---

## 💡 Pro Tips

1. **Name files consistently** - The system extracts student info from filenames
2. **Process in order** - Always: Atomize → OCR → Grade
3. **Check verification reports** - Found in `OCR_Verification_Report.txt`
4. **Review first exam carefully** - Set up rubric properly
5. **Use batch processing** - For end-of-term grading of multiple exams

---

## 📊 Next Steps

Once comfortable with the basics:

1. **Create custom grading rules** - Modify [SRG_Grader.js](SRG_Grader.js)
2. **Set up batch processing** - Use `batchProcessClass()` function
3. **Export to Sheets** - Connect results to gradebook
4. **Add analytics** - Track class performance over time

---

## 🆘 Need Help?

1. Check [EXAM_SYSTEM_README.md](EXAM_SYSTEM_README.md) for detailed docs
2. Run `testExamSystem()` to diagnose issues
3. Check execution logs: View → Execution log
4. Review status logs in the UI

---

## ✅ Checklist

Before your first grading session:

- [ ] Configured `ROOT_FOLDER_ID`
- [ ] Ran `testExamSystem()` successfully
- [ ] Deployed web app
- [ ] Created proper folder structure
- [ ] Added student PDFs to `Individual PDFs/`
- [ ] Markscheme contains "markscheme" or "ms" in filename
- [ ] Tested atomization on one exam
- [ ] Tested OCR on one student
- [ ] Verified grading output

**Ready to grade? You got this! 🎉**
