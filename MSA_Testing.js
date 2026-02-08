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

  msaLog_("=== All Atomizer Unit Tests Passed! ✅ ===");
}