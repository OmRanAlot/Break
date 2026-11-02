import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NativeModules, Switch, TextInput, Modal } from 'react-native';

NativeModules.SettingsModule = {
  saveUninstallPhrase: jest.fn(() => Promise.resolve(true)),
  enableUninstallPhrase: jest.fn(() => Promise.resolve(true)),
  requestUninstallPhraseDisable: jest.fn(),
  getUninstallPhraseDisableStatus: jest.fn(),
  confirmUninstallPhraseDisable: jest.fn(() => Promise.resolve(true)),
  // Change-gate methods.
  requestUninstallPhraseChange: jest.fn(),
  getUninstallPhraseChangeStatus: jest.fn(() =>
    Promise.resolve({ state: 'none', readyAt: 0, expiresAt: 0 }),
  ),
  changeUninstallPhrase: jest.fn(() => Promise.resolve(true)),
};
const SM = NativeModules.SettingsModule;

const DeletionPhraseSection = require('../../components/Customize/DeletionPhraseSection')
  .default;
const { normalizePhrase } = require('../../components/Customize/DeletionPhraseSection');

const PHRASE = 'DELETE BREAK NOW';
const NEW_PHRASE = 'STILL NOT DELETING';
const HOUR = 60 * 60 * 1000;

const render = async props => {
  const onSaved = jest.fn();
  let tree;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <DeletionPhraseSection
        parentEnabled
        enabled={false}
        savedPhrase=""
        onSaved={onSaved}
        {...props}
      />,
    );
  });
  return { tree, onSaved };
};

const toggle = async (tree, value) => {
  await act(async () => {
    await tree.root.findByType(Switch).props.onValueChange(value);
  });
};

describe('DeletionPhraseSection', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Existing tests ────────────────────────────────────────────────────────

  it('normalizes outer whitespace like the native contract', () => {
    expect(normalizePhrase('  a b  ')).toBe('a b');
    expect(normalizePhrase(null)).toBe('');
  });

  it('rejects enabling with a blank phrase and shows an error', async () => {
    const { tree, onSaved } = await render();
    await act(async () => {
      // Only one TextInput exists when the requirement is off.
      tree.root.findByType(TextInput).props.onChangeText('   ');
    });
    await toggle(tree, true);
    expect(SM.enableUninstallPhrase).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain('Enter a phrase');
  });

  it('saves the trimmed phrase then enables', async () => {
    const { tree, onSaved } = await render();
    await act(async () => {
      tree.root.findByType(TextInput).props.onChangeText(`  ${PHRASE} `);
    });
    await toggle(tree, true);
    expect(SM.saveUninstallPhrase).toHaveBeenCalledWith(PHRASE);
    expect(SM.enableUninstallPhrase).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(true, PHRASE);
  });

  it('turning off starts the wait and does NOT disable', async () => {
    const now = Date.now();
    SM.requestUninstallPhraseDisable.mockResolvedValue({
      state: 'waiting',
      readyAt: now + HOUR,
      expiresAt: now + HOUR + 15 * 60 * 1000,
    });
    const { tree, onSaved } = await render({ enabled: true, savedPhrase: PHRASE });
    await toggle(tree, false);
    expect(SM.requestUninstallPhraseDisable).toHaveBeenCalled();
    expect(SM.confirmUninstallPhraseDisable).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // The first Modal is the disable-gate one.
    const modals = tree.root.findAllByType(Modal);
    expect(modals[0].props.visible).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain('Please wait');
  });

  it('inside the ready window the modal lets the user turn it off', async () => {
    const now = Date.now();
    SM.requestUninstallPhraseDisable.mockResolvedValue({
      state: 'ready',
      readyAt: now - 1000,
      expiresAt: now + 10 * 60 * 1000,
    });
    const { tree, onSaved } = await render({ enabled: true, savedPhrase: PHRASE });
    await toggle(tree, false);
    const btn = tree.root.findByProps({ accessibilityLabel: 'Turn off phrase requirement' });
    await act(async () => {
      await btn.props.onPress();
    });
    expect(SM.confirmUninstallPhraseDisable).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(false, PHRASE);
  });

  it('refreshes status when native rejects a stale confirm', async () => {
    const now = Date.now();
    SM.requestUninstallPhraseDisable.mockResolvedValue({
      state: 'ready',
      readyAt: now - 1000,
      expiresAt: now + 1000,
    });
    SM.confirmUninstallPhraseDisable.mockRejectedValueOnce(new Error('x'));
    SM.getUninstallPhraseDisableStatus.mockResolvedValue({ state: 'none', readyAt: 0, expiresAt: 0 });
    const { tree, onSaved } = await render({ enabled: true, savedPhrase: PHRASE });
    await toggle(tree, false);
    const btn = tree.root.findByProps({ accessibilityLabel: 'Turn off phrase requirement' });
    await act(async () => {
      await btn.props.onPress();
    });
    expect(onSaved).not.toHaveBeenCalled();
    // Disable modal should now be hidden (gate refreshed to 'none').
    const modals = tree.root.findAllByType(Modal);
    expect(modals[0].props.visible).toBe(false);
  });

  it('toggle is disabled and input hidden when Deletion Prevention is off', async () => {
    const { tree } = await render({ parentEnabled: false });
    expect(tree.root.findByType(Switch).props.disabled).toBe(true);
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('reloads the draft from the saved phrase', async () => {
    const { tree } = await render({ enabled: true, savedPhrase: PHRASE });
    // phrase-input is the one with the savedPhrase value.
    const inputs = tree.root.findAllByType(TextInput);
    expect(inputs.some(i => i.props.value === PHRASE)).toBe(true);
  });

  it('shows the phrase as visible text (not a password)', async () => {
    const { tree } = await render();
    expect(tree.root.findByType(TextInput).props.secureTextEntry).toBeFalsy();
  });

  // ── New: change gate ──────────────────────────────────────────────────────

  it('phrase field is read-only (not editable) while enabled and outside the window', async () => {
    const { tree } = await render({ enabled: true, savedPhrase: PHRASE });
    // changeGate starts as 'none' (getUninstallPhraseChangeStatus returns none).
    // The phrase TextInput should have editable=false.
    const phraseInput = tree.root.findByProps({ accessibilityLabel: 'Deletion phrase' });
    expect(phraseInput.props.editable).toBe(false);
  });

  it('"Change phrase" button appears when enabled and calls requestUninstallPhraseChange without saving', async () => {
    const now = Date.now();
    SM.requestUninstallPhraseChange.mockResolvedValue({
      state: 'waiting',
      readyAt: now + HOUR,
      expiresAt: now + HOUR + 15 * 60 * 1000,
    });
    const { tree, onSaved } = await render({ enabled: true, savedPhrase: PHRASE });
    const changeBtn = tree.root.findByProps({ accessibilityLabel: 'Change phrase' });
    await act(async () => {
      await changeBtn.props.onPress();
    });
    expect(SM.requestUninstallPhraseChange).toHaveBeenCalled();
    expect(SM.saveUninstallPhrase).not.toHaveBeenCalled();
    expect(SM.changeUninstallPhrase).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // Change modal should show "Please wait".
    const modals = tree.root.findAllByType(Modal);
    const changeModal = modals[1];
    expect(changeModal.props.visible).toBe(true);
    expect(JSON.stringify(tree.toJSON())).toContain('Please wait');
  });

  it('in the ready window both current and new fields show and save calls changeUninstallPhrase', async () => {
    const now = Date.now();
    // Simulate getUninstallPhraseChangeStatus returning 'ready' on mount.
    SM.getUninstallPhraseChangeStatus.mockResolvedValueOnce({
      state: 'ready',
      readyAt: now - 1000,
      expiresAt: now + 10 * 60 * 1000,
    });
    const { tree, onSaved } = await render({ enabled: true, savedPhrase: PHRASE });
    // Allow the useEffect to resolve.
    await act(async () => {});

    const inputs = tree.root.findAllByType(TextInput);
    // Should have both current-phrase and new-phrase inputs.
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    const currentInput = tree.root.findByProps({ accessibilityLabel: 'Current deletion phrase' });
    const newInput = tree.root.findByProps({ accessibilityLabel: 'Deletion phrase' });
    expect(newInput.props.editable).toBe(true);

    await act(async () => {
      currentInput.props.onChangeText(PHRASE);
      newInput.props.onChangeText(NEW_PHRASE);
    });

    const saveBtn = tree.root.findByProps({ accessibilityLabel: 'Save new phrase' });
    await act(async () => {
      await saveBtn.props.onPress();
    });
    expect(SM.changeUninstallPhrase).toHaveBeenCalledWith(PHRASE, NEW_PHRASE);
    expect(onSaved).toHaveBeenCalledWith(true, NEW_PHRASE);
  });

  it('WRONG_CURRENT shows the right error message', async () => {
    const now = Date.now();
    SM.getUninstallPhraseChangeStatus.mockResolvedValueOnce({
      state: 'ready',
      readyAt: now - 1000,
      expiresAt: now + 10 * 60 * 1000,
    });
    SM.changeUninstallPhrase.mockRejectedValueOnce({ code: 'WRONG_CURRENT' });
    const { tree, onSaved } = await render({ enabled: true, savedPhrase: PHRASE });
    await act(async () => {});

    const currentInput = tree.root.findByProps({ accessibilityLabel: 'Current deletion phrase' });
    const newInput = tree.root.findByProps({ accessibilityLabel: 'Deletion phrase' });
    await act(async () => {
      currentInput.props.onChangeText('wrong phrase');
      newInput.props.onChangeText(NEW_PHRASE);
    });
    const saveBtn = tree.root.findByProps({ accessibilityLabel: 'Save new phrase' });
    await act(async () => {
      await saveBtn.props.onPress();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(JSON.stringify(tree.toJSON())).toContain("isn\u2019t your current phrase");
  });

  it('NOT_READY refreshes the change gate status and shows the error', async () => {
    const now = Date.now();
    SM.getUninstallPhraseChangeStatus
      .mockResolvedValueOnce({
        state: 'ready',
        readyAt: now - 1000,
        expiresAt: now + 1000,
      })
      .mockResolvedValueOnce({ state: 'none', readyAt: 0, expiresAt: 0 });
    SM.changeUninstallPhrase.mockRejectedValueOnce({ code: 'NOT_READY' });
    const { tree, onSaved } = await render({ enabled: true, savedPhrase: PHRASE });
    await act(async () => {});

    const currentInput = tree.root.findByProps({ accessibilityLabel: 'Current deletion phrase' });
    const newInput = tree.root.findByProps({ accessibilityLabel: 'Deletion phrase' });
    await act(async () => {
      currentInput.props.onChangeText(PHRASE);
      newInput.props.onChangeText(NEW_PHRASE);
    });
    const saveBtn = tree.root.findByProps({ accessibilityLabel: 'Save new phrase' });
    await act(async () => {
      await saveBtn.props.onPress();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(SM.getUninstallPhraseChangeStatus).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(tree.toJSON())).toContain('change window closed');
  });
});
