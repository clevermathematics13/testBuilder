# Exam Management System - Setup Guide

## Overview

This system provides a comprehensive UI for managing exams with three main functions:
1. **Markscheme Atomization** - Parse and structure marking schemes
2. **Student Work OCR** - Extract text from student PDFs with human verification
3. **Student Response Grader** - Automatically grade student work against atomized markschemes

## Setup Instructions

### 1. Configure Your Folder Structure

Your folder structure should look like:

```
Root Folder (e.g., "All Classes")
├── Class 1 (e.g., "IB Math HL 2025-2026")
│   ├── Exam 1 (e.g., "Midterm October 2025")
│   │   ├── exam.pdf
│   │   ├── markscheme.docx (Google Doc)
│   │   ├── Student Work/
│   │   │   ├── combined_all_students.pdf
│   │   │   └── Individual PDFs/
│   │   │       ├── Smith_John_12345_Q1.pdf
│   │   │       ├── Doe_Jane_12346_Q1.pdf
│   │   │       └── ...
│   │   └── [other files]
│   ├── Exam 2/
│   └── ...
├── Class 2 (e.g., "IB Math SL 2025-2026")
└── Past Classes (e.g., "IB Math HL 2024-2025")
```

### 2. Update Configuration

Edit `ExamUI_Backend.js` and update the `_getExamSystemConfig()` function:

```javascript
function _getExamSystemConfig() {
  return {
    // YOUR ROOT FOLDER ID (get from Drive URL)
    ROOT_FOLDER_ID: "YOUR_FOLDER_ID_HERE",
    
    // Keywords to identify current vs past classes
    CURRENT_CLASS_KEYWORDS: ["2025-2026", "Current"],
    PAST_CLASS_KEYWORDS: ["2024-2025", "2023-2024", "Past"],
    
    // Folder names (customize if needed)
    STUDENT_WORK_FOLDER_NAME: "Student Work",
    INDIVIDUAL_PDFS_FOLDER_NAME: "Individual PDFs",
  };
}
```

### 3. Deploy the Web App

1. Open your Apps Script project
2. Click **Deploy** → **New deployment**
3. Select type: **Web app**
4. Description: "Exam Management System"
5. Execute as: **Me**
6. Who has access: **Only myself** (or your organization)
7. Click **Deploy**
8. Copy the web app URL

### 4. Add Deployment Triggers (Optional)

For automated processing, you can set up time-driven triggers in Apps Script.

## Using the System

### Opening the UI

1. Visit your web app URL
2. Or add this function to call from the Apps Script editor:

```javascript
function openExamUI() {
  const html = HtmlService.createHtmlOutputFromFile('ExamUI')
    .setWidth(1200)
    .setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, 'Exam Management');
}
```

### Workflow

#### Step 1: Select Class and Exam
- Check "Include Past Classes" if needed
- Select your class from the dropdown
- Select the exam to work with

#### Step 2: Markscheme Atomization
- Click **"Markscheme Atomization"**
- The system will:
  - Find the markscheme document in the exam folder
  - Extract all marking points using OCR
  - Structure the points into a JSON format
  - Save results to a question-specific folder
- Review the log for completion status

#### Step 3: Student Work OCR
- Click **"Student Work OCR"**
- The system will:
  - Find all student PDFs in the "Individual PDFs" folder
  - Extract images from each PDF
  - Perform OCR on each page using Mathpix
  - Calculate confidence scores for each OCR result
  - Flag low-confidence results for human review

**Human Verification Workflow:**
- For pages with confidence < 85%:
  - A modal will appear showing the image and OCR text
  - Review and edit the OCR text if needed
  - Click "Approve & Continue" to save corrections
  - Repeat for all flagged pages

- Results are saved in:
  - `Student Work/StudentName/StudentName_pageX_ocr.txt` (text files)
  - `Student Work/StudentName/StudentName_ocr_summary.json` (JSON summary)
  - `Student Work/OCR_Corrections/` (corrected versions)

#### Step 4: Student Response Grader
- Click **"Student Response Grader"**
- The system will:
  - Load the atomized markscheme
  - Load the OCR'd student responses
  - Grade each student against the marking criteria
  - Generate a report with scores and feedback
- Results include:
  - Individual scores per marking point
  - Total score for each student
  - Class statistics (average, distribution)

## File Naming Conventions

### Student PDFs
Format: `LastName_FirstName_StudentID_Question.pdf`

Examples:
- `Smith_John_12345_Q1.pdf`
- `Doe_Jane_12346_Q1.pdf`

The system extracts:
- Student name: "Smith, John"
- Student ID: "12345"
- Question: "Q1"

### Markscheme Documents
Should contain keywords: "markscheme", "mark scheme", or "ms"

Examples:
- `markscheme_Q1.docx`
- `Q1_Mark_Scheme.docx`
- `Q1_MS.docx`

## OCR Confidence Scoring

The system calculates confidence based on:
1. **Mathpix confidence score** (if provided)
2. **Text length** (too short or too long = suspicious)
3. **OCR error patterns** (excessive pipes, spaces, non-ASCII)
4. **Math notation quality** (well-formed LaTeX increases confidence)

**Thresholds:**
- ≥ 85%: Auto-approved (no human review needed)
- < 85%: Flagged for human verification

## Customization

### Adjust Confidence Threshold

Edit `StudentWorkOCR.js`:

```javascript
const defaults = {
  confidenceThreshold: 0.85,  // Change this (0.0 to 1.0)
  // ...
};
```

### Modify Student Name Extraction

Edit the `extractStudentInfo()` function in `StudentWorkOCR.js` to match your naming convention.

### Add Custom Grading Rules

The grading system uses the existing `SRG_Grader.js` logic. Modify `srgMatchRequirement_()` to add custom matching strategies.

## Troubleshooting

### "Class folder not found"
- Verify ROOT_FOLDER_ID in `_getExamSystemConfig()`
- Check folder sharing permissions

### "Markscheme not found"
- Ensure markscheme file contains keywords: "markscheme", "mark scheme", or "ms"
- Check file is in the exam folder (not a subfolder)

### "OCR failed"
- Check Mathpix API credentials in `MSA_Config.js`
- Verify image quality (min 150 DPI recommended)
- Check file permissions

### "Low OCR confidence"
- Review image quality
- Check for:
  - Handwriting clarity
  - Scan/photo resolution
  - Lighting and contrast
  - Proper orientation

## Advanced Features

### Batch Processing
Process multiple exams at once by creating a batch script:

```javascript
function processBatchExams() {
  const examIds = [
    "EXAM_FOLDER_ID_1",
    "EXAM_FOLDER_ID_2",
    // ...
  ];
  
  examIds.forEach(examId => {
    runMarkschemeAtomization(examId);
    runStudentWorkOcr(examId);
    runStudentGrading(examId);
  });
}
```

### Export Results
Results can be exported to:
- Google Sheets (for analysis)
- CSV files (for external tools)
- PDF reports (for distribution)

## Support

For issues or questions:
1. Check the status log in the UI
2. Review execution logs in Apps Script (View → Logs)
3. Check the verification reports in output folders

## Future Enhancements

- [ ] Exam creation wizard
- [ ] Multi-page PDF splitting
- [ ] QR code scanning for student identification
- [ ] Advanced grading rubrics
- [ ] Integration with Google Classroom
- [ ] Detailed analytics dashboard
- [ ] Bulk feedback generation
