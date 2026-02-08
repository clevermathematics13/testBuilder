/************************
 * MSA_Testing.gs
 *
 * A place for focused unit and integration tests for the MSA pipeline.
 * Run these functions from the Apps Script editor to test logic in isolation.
 ************************/

/**
 * A simple assertion helper to make tests clearer.
 * It uses your existing logging functions (msaLog_, msaErr_).
 */
function assert_(condition, message) {
  if (!condition) {
    var msg = "Assertion Failed: " + message;
    msaErr_(msg); // Use your existing error logger
    throw new Error(msg);
  } else {
    msaLog_("Assertion Passed: " + message);
  }
}

/**
 * Test suite for the MSA Atomizer passes.
 * This function uses MOCK data to test the logic of Pass 1, 2, and 3
 * without needing to run the full OCR pipeline. This is much faster
 * and helps isolate parsing bugs.
 */
function testAtomizerPasses() {
  msaLog_("=== Running Atomizer Unit Tests ===");

  // --- Test Case 1: Simple, clean input ---
  var mockOcrPages_Simple = [{
    page: 1,
    text: "(a) (i) evidence of substitution\n(M1)\n      A = 1000(1 + 0.05/4)^(4*5)\n1282.037...\nA = 1282 (A1)\n[2 marks]"
  }];
  var cfg = msaGetConfig_(); // Assumes msaGetConfig_ is available
  var mockRules = msaLoadGradingRules_(cfg).rules;

  var pass1_simple = msaAtomizePass1_(mockOcrPages_Simple, mockRules, null);
  assert_(pass1_simple.points.length === 2, "Test 1, Pass 1: Should find 2 points.");
  assert_(pass1_simple.points[0].mark === "M1", "Test 1, Pass 1: First mark should be M1.");
  assert_(pass1_simple.points[1].mark === "A1", "Test 1, Pass 1: Second mark should be A1.");
  msaLog_("✅ Test Case 1 Passed");


  // --- Test Case 2: Input designed to trigger Pass 2 (double mark) ---
  var mockOcrPages_DoubleMark = [{
    page: 1,
    text: "correct substitution (A1,A1)\nNote: Award A1 for a correct numerator and A1 for a correct denominator.\n(2 marks)"
  }];
  var ocrByPage_DoubleMark = { "1": mockOcrPages_DoubleMark[0].text.split('\n') };

  // Pass 1 should detect the double mark and normalize it to "A1A1"
  var pass1_double = msaAtomizePass1_(mockOcrPages_DoubleMark, mockRules, null);
  assert_(pass1_double.points.length === 1, "Test 2, Pass 1: Should initially find 1 point.");
  assert_(pass1_double.points[0].mark === "A1A1", "Test 2, Pass 1: Mark should be normalized to 'A1A1'.");

  // Now run Pass 2 on this output
  var pass2_double = msaAtomizerPass2_(pass1_double, ocrByPage_DoubleMark);
  assert_(pass2_double.points.length === 2, "Test 2, Pass 2: Should split the point into 2.");
  assert_(pass2_double.points[0].mark === "A1", "Test 2, Pass 2: First split mark should be A1.");
  assert_(pass2_double.points[0].requirement.includes("numerator"), "Test 2, Pass 2: First req should mention numerator.");
  msaLog_("✅ Test Case 2 Passed");


  // --- Test Case 3: Input designed to trigger Pass 3 (THEN branch) ---
  var mockOcrPages_Then = [{
    page: 1,
    text: "(c) substitutes into formula (M1)\nTHEN\ncorrectly evaluates (A1)\n= -1/4"
  }];
  var ocrByPage_Then = { "1": mockOcrPages_Then[0].text.split('\n') };

  var pass1_then = msaAtomizePass1_(mockOcrPages_Then, mockRules, null);
  assert_(pass1_then.points.length === 2, "Test 3, Pass 1: Should find 2 points (M1, A1).");
  var thenAPoint_before = pass1_then.points.find(p => p.branch === 'THEN' && p.mark === 'A1');
  assert_(thenAPoint_before, "Test 3, Pass 1: Should find an A1 point in a THEN branch.");

  // Now run Pass 3 on this output
  var pass3_then = msaAtomizerPass3_(pass1_then, ocrByPage_Then);
  var thenAPoint_after = pass3_then.points.find(p => p.branch === 'THEN' && p.mark === 'A1');
  assert_(thenAPoint_after.notes.some(n => n.includes("captured final value after THEN: -1/4")), "Test 3, Pass 3: Should capture the final value '-1/4' in notes.");
  msaLog_("✅ Test Case 3 Passed");


  // --- Test Case 4: Input for Pass 2 "Simple Split" (mixed marks) ---
  var mockOcrPages_MixedMark = [{
    page: 1,
    text: "(a) some requirement\nA2N2\n[4 marks]"
  }];
  var ocrByPage_MixedMark = { "1": mockOcrPages_MixedMark[0].text.split('\n') };

  // Pass 1 should find one compound point
  var pass1_mixed = msaAtomizePass1_(mockOcrPages_MixedMark, mockRules, null);
  assert_(pass1_mixed.points.length === 1, "Test 4, Pass 1: Should find 1 compound point.");
  assert_(pass1_mixed.points[0].mark === "A2N2", "Test 4, Pass 1: Mark should be 'A2N2'.");

  // Pass 2 should perform a simple split
  var pass2_mixed = msaAtomizerPass2_(pass1_mixed, ocrByPage_MixedMark);
  assert_(pass2_mixed.points.length === 2, "Test 4, Pass 2: Should split into 2 points.");
  assert_(pass2_mixed.points[0].mark === "A2", "Test 4, Pass 2: First split mark should be A2.");
  assert_(pass2_mixed.points[1].mark === "N2", "Test 4, Pass 2: Second split mark should be N2.");
  assert_(pass2_mixed.points[0].notes.some(n => n.includes("Simple split")), "Test 4, Pass 2: Should contain a simple split note.");
  msaLog_("✅ Test Case 4 Passed");


  // --- Test Case 5: Real-world complex case from 18M.1.SL.TZ2.S_5 ---
  var mockOcr_RealWorld = [{
    page: 1,
    text: "(a)\n\nA2 N2\n\n[2 marks]\n(b) recognizing horizontal shift/translation of 1 unit\n\n(M1)\n\neg \\quad b=1 , moved 1 right\n\n(M1)\n\nrecognizing vertical stretch/dilation with scale factor 2\n\n(M1)\n\neg \\quad a=2, y \\times(-2)\n\\[\na=-2, b=-1\n\\]\n\nA1A1\nN2N2\n[4 marks]\n[Total: 6 marks]"
  }];
  var ocrByPage_RealWorld = { "1": mockOcr_RealWorld[0].text.split('\n') };

  // Pass 1 should find 6 points, some of which are compound
  var pass1_real = msaAtomizePass1_(mockOcr_RealWorld, mockRules, null);
  assert_(pass1_real.points.length === 6, "Test 5, Pass 1: Should find 6 points initially.");
  assert_(pass1_real.points.some(p => p.mark === 'A2N2'), "Test 5, Pass 1: Should find A2N2 compound mark.");
  assert_(pass1_real.points.some(p => p.mark === 'A1A1'), "Test 5, Pass 1: Should find A1A1 compound mark.");
  assert_(pass1_real.points.some(p => p.mark === 'N2N2'), "Test 5, Pass 1: Should find N2N2 compound mark.");

  // Pass 2 should split the compound marks, resulting in 9 total points
  var pass2_real = msaAtomizerPass2_(pass1_real, ocrByPage_RealWorld);
  assert_(pass2_real.points.length === 9, "Test 5, Pass 2: Should split to 9 total points.");
  const pass2_marks = pass2_real.points.map(p => p.mark);
  const countOf = (arr, val) => arr.reduce((a, v) => (v === val ? a + 1 : a), 0);
  assert_(countOf(pass2_marks, 'A2') === 1, "Test 5, Pass 2: Should have one A2 mark.");
  assert_(countOf(pass2_marks, 'N2') === 3, "Test 5, Pass 2: Should have three N2 marks (1 from A2N2, 2 from N2N2).");
  assert_(countOf(pass2_marks, 'A1') === 2, "Test 5, Pass 2: Should have two A1 marks.");
  assert_(countOf(pass2_marks, 'M1') === 3, "Test 5, Pass 2: Should have three M1 marks.");
  msaLog_("✅ Test Case 5 Passed");

  msaLog_("=== All Atomizer Unit Tests Passed! ✅ ===");
}