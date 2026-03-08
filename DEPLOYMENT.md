# Deployment Instructions

## Option 1: Web App (No Banner, No Spreadsheet Needed) ✅ RECOMMENDED

1. Open your Apps Script project: https://script.google.com/d/1ZmPjnWL1fspXFuytq-4r85UkSHJrc10TSAE2kBUzja0K4r8ibnJQAeJ7/edit

2. Click **Deploy** > **New deployment**

3. Select type: **Web app**

4. Configure:
   - Description: "Exam Management System"
   - Execute as: **Me**
   - Who has access: **Anyone** (or "Only myself" for testing)

5. Click **Deploy**

6. Copy the web app URL (looks like: https://script.google.com/macros/s/AKfy...../exec)

7. Open that URL in your browser - you'll see the Exam Management UI with **NO BANNER**!

**To access different UIs:**
- Default URL → Exam Management UI (new, banner-free)
- Add `?ui=msa` → MSA Validation UI (old)

---

## Option 2: From Google Sheets (If you need spreadsheet integration)

1. Create or open any Google Sheet

2. Go to **Extensions** > **Apps Script**

3. **Copy all your code files** into that bound script:
   - ExamUI.html
   - ExamUI_Backend.js
   - ExamSystem_Integration.js
   - StudentWorkOCR.js
   - SRG_Grader.js
   - MSA_*.js files
   - etc.

4. Add this onOpen trigger:
   ```javascript
   function onOpen() {
     createExamSystemMenu();
   }
   ```

5. Refresh the sheet - you'll see a "🎓 Exam System" menu

6. Click **Exam System** > **📊 Exam Management** to open the modal (no banner!)

---

## Current Setup

Your deployment ID from .env: `AKfycbwyiLmFkLWkwJKNHka7D6pyP7obB5wPjDz7IyQ-uahE7DqqEg8Ojf-i54OIHCOxcRhP4w`

This is for the Execution API (used by `npm run test:grade`). For the web UI, you need a separate web app deployment.
