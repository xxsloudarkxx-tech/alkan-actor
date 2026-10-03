import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyProjectStage, stageActionabilityBonus } from '../src/signals/project-stage.js';

test('maps the key Seattle statuses deterministically', () => {
  assert.equal(classifyProjectStage('Issued').stage, 'issued');
  assert.equal(classifyProjectStage('Ready for Intake').stage, 'intake');
  assert.equal(classifyProjectStage('Application Completed').stage, 'intake');
  assert.equal(classifyProjectStage('Reviews In Process').stage, 'review');
  assert.equal(classifyProjectStage('Corrections Required').stage, 'review');
  assert.equal(classifyProjectStage('Cancelled').stage, 'inactive');
  assert.equal(classifyProjectStage('Expired').stage, 'inactive');
  assert.equal(classifyProjectStage('Withdrawn').stage, 'inactive');
  assert.equal(classifyProjectStage('Completed').stage, 'completed');
  assert.equal(classifyProjectStage('').stage, 'unknown');
  assert.equal(classifyProjectStage(null).stage, 'unknown');
});

test('emits warnings for the flagged statuses', () => {
  assert.ok(classifyProjectStage('Ready for Intake').warnings.length > 0);
  assert.ok(classifyProjectStage('Application Completed').warnings.some((w) => /not yet issued/i.test(w)));
  assert.ok(classifyProjectStage('Reviews In Process').warnings.length > 0);
  assert.ok(classifyProjectStage('Corrections Required').warnings.some((w) => /correction/i.test(w)));
  assert.ok(classifyProjectStage('Expired').warnings.some((w) => /expired/i.test(w)));
  assert.ok(classifyProjectStage('Cancelled').warnings.some((w) => /cancell/i.test(w)));
  assert.ok(classifyProjectStage('Withdrawn').warnings.some((w) => /withdrawn/i.test(w)));
});

test('issued/active permits get the highest operational bonus (not a credit factor)', () => {
  assert.equal(stageActionabilityBonus('issued'), 20);
  assert.equal(stageActionabilityBonus('active'), 20);
  assert.equal(stageActionabilityBonus('review'), 10);
  assert.equal(stageActionabilityBonus('intake'), 5);
  assert.equal(stageActionabilityBonus('completed'), 0);
  assert.equal(stageActionabilityBonus('inactive'), 0);
  assert.equal(stageActionabilityBonus('unknown'), 0);
});
