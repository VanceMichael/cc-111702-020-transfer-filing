import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startFixture } from '../src/fixture.mjs';
import { createProduct } from '../src/product.mjs';
const joint = JSON.parse(await readFile(new URL('../fixtures/joint-source.json', import.meta.url), 'utf8'));
const single = JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url), 'utf8'));

async function withFixture(script, operation) {
  const fixture = await startFixture(structuredClone(script));
  try { return await operation(fixture); } finally { await fixture.close(); }
}
const confirmation = (holder, extra = {}) => ({ holder, confirmed: true, ...extra });
const allConfirmations = () => [confirmation('H1'), confirmation('H2'), confirmation('H3')];
const baseApplication = () => structuredClone(joint.routes[0].responses[0].body);
const baseDraft = () => structuredClone(joint.routes[2].responses[0].body);

function applicationOf(view, id = 'APP1') { return view.applications.find(item => item.application === id); }
function confirmationOf(view, holder) { return applicationOf(view).confirmations.find(item => item.holder === holder); }

test('三家持有人分别确认后由代表汇总提交', async () => {
  await withFixture(joint, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const view = await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const application = applicationOf(view);
    assert.deepEqual(application.holders.map(item => item.share), [40, 35, 25]);
    assert.equal(application.representative, 'H1');
    assert.equal(application.status, 'ready');
    assert.equal(application.canSubmit, true);
    assert.deepEqual(application.pending, []);
    for (const holder of ['H1', 'H2', 'H3']) {
      const item = confirmationOf(view, holder);
      assert.equal(item.valid, true, holder);
      assert.deepEqual(item.seenHolders.map(entry => entry.id), ['H1', 'H2', 'H3']);
    }
    assert.equal(fixture.calls.filter(call => call.path === '/confirmations').length, 3);
  });
});

test('代表不能替其他持有人确认', async () => {
  await withFixture(joint, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await assert.rejects(product.collect({ confirmations: [confirmation('H2')], actor: 'H1', role: 'representative' }), /代表只能汇总和提交/);
    assert.deepEqual(product.view().applications, []);
  });
});

test('更正联系人不会使确认失效', async () => {
  await withFixture(joint, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({ corrections: [{ holder: 'H2', contact: { name: '新联系人', phone: '010-00000099' } }] });
    const application = applicationOf(view);
    assert.equal(application.contacts.H2.phone, '010-00000099');
    assert.equal(confirmationOf(view, 'H2').valid, true);
    assert.deepEqual(application.pending, []);
    assert.equal(application.canSubmit, true);
  });
});

test('份额变化使其他单位的确认失效并说明原因', async () => {
  const changed = structuredClone(joint);
  changed.routes[0].responses.push({
    body: {
      ...baseApplication(),
      applicationRevision: 2,
      holders: [
        { id: 'H1', share: 50 },
        { id: 'H2', share: 30 },
        { id: 'H3', share: 20 }
      ]
    }
  });
  await withFixture(changed, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({});
    const application = applicationOf(view);
    assert.equal(application.canSubmit, false);
    assert.equal(application.status, 'pending-confirmation');
    for (const holder of ['H1', 'H2', 'H3']) {
      const item = confirmationOf(view, holder);
      assert.equal(item.valid, false);
      assert.equal(item.code, 'ARRANGEMENT_CHANGED');
      assert.equal(item.arrangementMatches, false);
      assert.equal(item.materialRetained, true);
      assert.deepEqual(item.seenMaterials, [{ id: `M${holder.slice(1)}`, revision: 1 }]);
    }
    assert.equal(application.pending.length, 3);
    assert.ok(application.pending.every(item => /份额安排已变化/.test(item.reason)));
    assert.equal(application.reasons.length, 3);
  });
});

test('资料版本变化只让该单位的确认失效', async () => {
  const changed = structuredClone(joint);
  changed.routes[0].responses.push({
    body: {
      ...baseApplication(),
      applicationRevision: 2,
      materials: [
        { id: 'M1', holder: 'H1', revision: 1 },
        { id: 'M2', holder: 'H2', revision: 2 },
        { id: 'M3', holder: 'H3', revision: 1 }
      ]
    }
  });
  await withFixture(changed, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({});
    assert.equal(confirmationOf(view, 'H1').valid, true);
    assert.equal(confirmationOf(view, 'H3').valid, true);
    const stale = confirmationOf(view, 'H2');
    assert.equal(stale.valid, false);
    assert.equal(stale.code, 'MATERIAL_CHANGED');
    assert.deepEqual(stale.changedMaterials, ['M2']);
    assert.equal(applicationOf(view).canSubmit, false);
  });
});

test('已确认字段为真也不能替代依据核对', async () => {
  await withFixture(joint, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const staleBasis = { holder: 'H2', confirmed: true, seenHolders: [{ id: 'H1', share: 60 }, { id: 'H2', share: 40 }], seenMaterials: [{ id: 'M2', revision: 1 }] };
    const view = await product.collect({ confirmations: [confirmation('H1'), staleBasis], representation: 'H1', draft: 'D1' });
    const item = confirmationOf(view, 'H2');
    assert.equal(item.confirmed, true);
    assert.equal(item.valid, false);
    assert.equal(item.code, 'ARRANGEMENT_CHANGED');
    assert.deepEqual(applicationOf(view).pending.map(entry => entry.holder), ['H2', 'H3']);
    assert.equal(applicationOf(view).canSubmit, false);
  });
});

test('换代表后已上传草稿以门户实际回读为准', async () => {
  const changed = structuredClone(joint);
  changed.routes[0].responses.push({ body: { ...baseApplication(), applicationRevision: 2, representative: 'H2' } });
  changed.routes[2].responses.push({ body: { ...baseDraft(), canOperate: false } });
  await withFixture(changed, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({ representation: 'H2', draft: 'D1', actor: 'H2', role: 'representative' });
    const application = applicationOf(view);
    assert.equal(application.representative, 'H2');
    assert.equal(application.canSubmit, false);
    assert.equal(application.status, 'blocked');
    assert.equal(application.portal.canOperate, false);
    const draft = application.drafts[0];
    assert.equal(draft.canOperate, false);
    assert.deepEqual(draft.attachments.map(item => item.holder), ['H1', 'H2', 'H3']);
    assert.ok(application.reasons.some(reason => /不能继续操作/.test(reason)));
  });
});

test('换代表不改写其他单位已确认的资料归属', async () => {
  const changed = structuredClone(joint);
  changed.routes[0].responses.push({ body: { ...baseApplication(), applicationRevision: 2, representative: 'H2' } });
  await withFixture(changed, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({ representation: 'H2', draft: 'D1' });
    const application = applicationOf(view);
    assert.equal(confirmationOf(view, 'H3').seenMaterials[0].id, 'M3');
    assert.equal(confirmationOf(view, 'H3').holder, 'H3');
    assert.deepEqual(application.drafts[0].attachments.find(item => item.id === 'M3').holder, 'H3');
  });
});

test('持有人退出后其他单位资料不被划归新代表', async () => {
  const changed = structuredClone(joint);
  changed.routes[0].responses.push({
    body: {
      ...baseApplication(),
      applicationRevision: 2,
      holders: [{ id: 'H1', share: 60 }, { id: 'H2', share: 40 }],
      representative: 'H2',
      materials: [{ id: 'M1', holder: 'H1', revision: 1 }, { id: 'M2', holder: 'H2', revision: 1 }]
    }
  });
  changed.routes[2].responses.push({ body: { ...baseDraft(), canOperate: false } });
  await withFixture(changed, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({ representation: 'H2', draft: 'D1' });
    const application = applicationOf(view);
    assert.deepEqual(application.holders.map(item => item.id), ['H1', 'H2']);
    assert.equal(application.exited.length, 1);
    assert.equal(application.exited[0].holder, 'H3');
    assert.deepEqual(application.exited[0].materials, ['M3']);
    assert.ok(application.retiredMaterials.some(item => item.id === 'M3' && item.holder === 'H3'));
    assert.deepEqual(application.drafts[0].attachments.find(item => item.id === 'M3').holder, 'H3');
    assert.equal(confirmationOf(view, 'H3').status, 'exited');
    assert.ok(!application.pending.some(item => item.holder === 'H3'));
  });
});

test('门户已受理后按补正办理且不新建相同申请', async () => {
  const accepted = structuredClone(joint);
  accepted.routes[2].responses.push({ body: { ...baseDraft(), acceptedReceipt: 'ACK-J1' } });
  await withFixture(accepted, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const first = await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    assert.equal(applicationOf(first).portal.accepted, false);
    assert.equal(applicationOf(first).canSubmit, true);
    const second = await product.collect({ representation: 'H1', draft: 'D1' });
    assert.equal(applicationOf(second).portal.accepted, true);
    assert.equal(applicationOf(second).portal.acceptedReceipt, 'ACK-J1');
    assert.equal(applicationOf(second).canSubmit, false);
    assert.equal(applicationOf(second).status, 'accepted-correction');
    const corrected = await product.collect({
      representation: 'H1',
      draft: 'D1',
      submit: true,
      corrections: [{ holder: 'H2', content: { note: '补正联系人' } }]
    });
    const application = applicationOf(corrected);
    assert.equal(application.acceptedReceipt, 'ACK-J1');
    assert.equal(application.portal.receiptPreserved, true);
    assert.equal(application.corrections.length, 1);
    assert.equal(application.corrections[0].holder, 'H2');
    assert.equal(application.corrections[0].ordinal, 1);
    assert.ok(application.reasons.some(reason => /只能按门户允许的补正/.test(reason)));
    assert.equal(fixture.calls.filter(call => call.path === '/portal/drafts/D1/corrections').length, 1);
    assert.equal(applicationOf(corrected).drafts.length, 1);
    assert.equal(corrected.applications.length, 1);
    assert.equal(application.submissions.length, 1);
  });
});

test('尚未受理时要求先提交草稿再做补正', async () => {
  await withFixture(joint, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    await assert.rejects(product.collect({ draft: 'D1', submit: true, corrections: [{ holder: 'H1', content: {} }] }), /尚未受理/);
    assert.equal(fixture.calls.filter(call => call.path === '/portal/drafts/D1/corrections').length, 0);
  });
});

test('待确认时可以继续收齐有效材料', async () => {
  await withFixture(joint, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const partial = await product.collect({ confirmations: [confirmation('H1')], representation: 'H1', draft: 'D1' });
    assert.equal(applicationOf(partial).status, 'pending-confirmation');
    assert.deepEqual(applicationOf(partial).pending.map(item => item.holder), ['H2', 'H3']);
    const complete = await product.collect({ confirmations: [confirmation('H2'), confirmation('H3')], representation: 'H1', draft: 'D1' });
    assert.equal(applicationOf(complete).status, 'ready');
    assert.equal(applicationOf(complete).canSubmit, true);
    assert.equal(confirmationOf(complete, 'H1').valid, true);
    assert.equal(fixture.calls.filter(call => call.path === '/confirmations').length, 3);
  });
});

test('联合确认保留到状态重开后可追溯', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'joint-'));
  try {
    await withFixture(joint, async fixture => {
      const statePath = join(directory, 'state.json');
      const first = await createProduct({ sourceUrl: fixture.url, statePath });
      const view = await first.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
      const second = await createProduct({ sourceUrl: fixture.url, statePath });
      assert.deepEqual(second.view(), view);
      const application = applicationOf(second.view());
      assert.equal(application.representative, 'H1');
      assert.equal(application.confirmations.length, 3);
      assert.equal(application.drafts[0].canOperate, true);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('代表以外的操作者不能读取草稿或确认', async () => {
  await withFixture(joint, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    await assert.rejects(product.collect({ draft: 'D1', actor: 'H2' }), /只有当前代表/);
    await assert.rejects(product.collect({ confirmations: [{ holder: 'H1', confirmed: true, confirmation: 'CF-H1' }], actor: 'H2', role: 'holder' }), /持有人只能确认自己的资料/);
  });
});

test('单持有人样例仍可办理', async () => {
  await withFixture(single, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const view = await product.collect({});
    assert.equal(applicationOf(view).canSubmit, false);
    assert.equal(applicationOf(view).portal.accepted, true);
    assert.equal(applicationOf(view).submissions[0].accepted, true);
  });
});

test('某家确认被来源拒绝时只让该家回到待办', async () => {
  const denied = structuredClone(joint);
  denied.routes[1].responses[1] = { status: 409, body: { error: '来源不受理该确认' } };
  await withFixture(denied, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const view = await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const application = applicationOf(view);
    assert.equal(application.status, 'pending-confirmation');
    assert.equal(application.canSubmit, false);
    assert.deepEqual(application.pending.map(item => item.holder), ['H2']);
    assert.equal(application.pending[0].code, 'SOURCE_REJECTED');
    assert.ok(/H2/.test(application.pending[0].reason));
    assert.equal(confirmationOf(view, 'H1').valid, true);
    assert.equal(confirmationOf(view, 'H3').valid, true);
    assert.deepEqual(application.pending[0].retainedMaterials, [{ id: 'M2', revision: 1 }]);
  });
});

test('门户回读缺少可操作结论时不提交本地状态', async () => {
  const incomplete = structuredClone(joint);
  incomplete.routes[2].responses = [{ body: { draft: 'D1', ownerApplication: 'APP1', attachments: [] } }];
  await withFixture(incomplete, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await assert.rejects(product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' }), /未给出可继续操作结论/);
    assert.deepEqual(product.view().applications, []);
  });
});

test('换代表时自动回读门户草稿，即使没有显式给出草稿', async () => {
  const changed = structuredClone(joint);
  changed.routes[0].responses.push({ body: { ...baseApplication(), applicationRevision: 2, representative: 'H2' } });
  changed.routes[2].responses.push({ body: { ...baseDraft(), canOperate: false } });
  await withFixture(changed, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({});
    const application = applicationOf(view);
    assert.equal(application.representative, 'H2');
    assert.equal(application.drafts[0].canOperate, false);
    assert.equal(application.status, 'blocked');
    assert.equal(fixture.calls.filter(call => call.path === '/portal/drafts/D1').length, 2);
    assert.deepEqual(application.representativeHistory, ['H1']);
  });
});

test('门户回读不再显示受理时保留原受理依据而不重开', async () => {
  const accepted = structuredClone(joint);
  accepted.routes[2].responses.push(
    { body: { ...baseDraft(), acceptedReceipt: 'ACK-J3' } },
    { body: { ...baseDraft(), canOperate: false } }
  );
  await withFixture(accepted, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    await product.collect({ representation: 'H1', draft: 'D1' });
    const view = await product.collect({ representation: 'H1', draft: 'D1' });
    const application = applicationOf(view);
    assert.equal(application.acceptedReceipt, 'ACK-J3');
    assert.equal(application.portal.acceptedReceipt, 'ACK-J3');
    assert.equal(application.portal.receiptPreserved, true);
    assert.equal(application.canSubmit, false);
    assert.equal(application.status, 'accepted-correction');
    assert.equal(application.submissions.length, 1);
    assert.equal(application.drafts.length, 1);
    assert.ok(application.reasons.some(reason => /保留本地受理依据/.test(reason)));
  });
});

test('持有人退出后新代表只继承办理权，不继承资料', async () => {
  const changed = structuredClone(joint);
  changed.routes[0].responses.push({
    body: {
      ...baseApplication(),
      applicationRevision: 2,
      holders: [{ id: 'H1', share: 60 }, { id: 'H2', share: 40 }],
      representative: 'H2',
      materials: [{ id: 'M1', holder: 'H1', revision: 1 }, { id: 'M2', holder: 'H2', revision: 1 }]
    }
  });
  changed.routes[2].responses.push({ body: { ...baseDraft(), canOperate: true } });
  await withFixture(changed, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({});
    const application = applicationOf(view);
    assert.equal(application.representative, 'H2');
    assert.deepEqual(application.exited.map(item => item.holder), ['H3']);
    assert.equal(confirmationOf(view, 'H3').status, 'exited');
    assert.ok(application.confirmations.filter(item => item.holder !== 'H3').every(item => item.code === 'ARRANGEMENT_CHANGED'));
    assert.ok(application.drafts[0].attachments.every(item => ['H1', 'H2', 'H3'].includes(item.holder)));
    assert.notEqual(application.drafts[0].attachments.find(item => item.id === 'M3').holder, 'H2');
  });
});

test('已受理后不能改用其他草稿隐藏旧受理', async () => {
  const accepted = structuredClone(joint);
  accepted.routes[2].responses.push({ body: { ...baseDraft(), acceptedReceipt: 'ACK-K1' } });
  await withFixture(accepted, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    await product.collect({ representation: 'H1', draft: 'D1' });
    await assert.rejects(product.collect({ representation: 'H1', draft: 'D2' }), /已受理/);
    assert.equal(applicationOf(product.view()).acceptedReceipt, 'ACK-K1');
  });
});

test('退出后份额让与其他单位时仍要求新安排下的确认', async () => {
  const changed = structuredClone(joint);
  changed.routes[0].responses.push({
    body: {
      ...baseApplication(),
      applicationRevision: 2,
      holders: [{ id: 'H1', share: 60 }, { id: 'H2', share: 40 }],
      representative: 'H1',
      materials: [{ id: 'M1', holder: 'H1', revision: 1 }, { id: 'M2', holder: 'H2', revision: 1 }]
    }
  });
  changed.routes[2].responses.push({ body: { ...baseDraft(), canOperate: true } });
  const reconfirmBasis = [{ id: 'H1', share: 60 }, { id: 'H2', share: 40 }];
  changed.routes[1].responses.push(
    { body: { confirmation: 'CF-H1B', application: 'APP1', holder: 'H1', seenRevision: 2, seenHolders: reconfirmBasis, seenMaterials: [{ id: 'M1', revision: 1 }], confirmed: true } },
    { body: { confirmation: 'CF-H2B', application: 'APP1', holder: 'H2', seenRevision: 2, seenHolders: reconfirmBasis, seenMaterials: [{ id: 'M2', revision: 1 }], confirmed: true } }
  );
  await withFixture(changed, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    const view = await product.collect({});
    const application = applicationOf(view);
    assert.deepEqual(application.pending.map(item => item.holder), ['H1', 'H2']);
    assert.ok(application.pending.every(item => item.code === 'ARRANGEMENT_CHANGED'));
    assert.equal(application.canSubmit, false);
    assert.equal(confirmationOf(view, 'H1').seenHolders.length, 3);
    assert.equal(confirmationOf(view, 'H1').materialRetained, true);
    const reconfirmed = await product.collect({ confirmations: [confirmation('H1'), confirmation('H2')], representation: 'H1', draft: 'D1' });
    const after = applicationOf(reconfirmed);
    assert.equal(after.status, 'ready');
    assert.equal(after.canSubmit, true);
    assert.deepEqual(after.exited.map(item => item.holder), ['H3']);
  });
});

test('来源回执与提交的确认依据冲突时保留提交依据并记录冲突', async () => {
  const conflicted = structuredClone(joint);
  conflicted.routes[1].responses[1] = {
    body: {
      confirmation: 'CF-H2-X',
      application: 'APP1',
      holder: 'H2',
      seenRevision: 1,
      seenHolders: [{ id: 'H1', share: 99 }, { id: 'H2', share: 1 }],
      seenMaterials: [{ id: 'M2', revision: 1 }],
      confirmed: true
    }
  };
  await withFixture(conflicted, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    const submittedBasis = [{ id: 'H1', share: 40 }, { id: 'H2', share: 35 }, { id: 'H3', share: 25 }];
    const view = await product.collect({
      confirmations: [confirmation('H1'), confirmation('H2', { seenHolders: submittedBasis }), confirmation('H3')],
      representation: 'H1',
      draft: 'D1'
    });
    const item = confirmationOf(view, 'H2');
    assert.equal(item.valid, true);
    assert.deepEqual(item.seenHolders, submittedBasis);
    assert.ok(/持有人名单与提交不符/.test(item.sourceConflict));
    assert.equal(applicationOf(view).status, 'ready');
  });
});

test('业务申请可追溯到确认依据、草稿和受理状态', async () => {
  const accepted = structuredClone(joint);
  accepted.routes[2].responses.push({ body: { ...baseDraft(), acceptedReceipt: 'ACK-J2' } });
  await withFixture(accepted, async fixture => {
    const product = await createProduct({ sourceUrl: fixture.url });
    await product.collect({ confirmations: allConfirmations(), representation: 'H1', draft: 'D1' });
    await product.collect({ representation: 'H1', draft: 'D1' });
    const application = applicationOf(product.view());
    assert.equal(application.portal.acceptedReceipt, 'ACK-J2');
    assert.equal(application.drafts[0].receipt, 'ACK-J2');
    assert.equal(application.submissions.length, 1);
    assert.equal(application.submissions[0].accepted, true);
    assert.equal(application.drafts[0].history.length, 2);
    assert.equal(application.confirmations.length, 3);
    assert.ok(application.confirmations.every(item => item.seenHolders.length === 3 && item.seenMaterials.length === 1));
    assert.ok(Array.isArray(application.transitions));
  });
});
