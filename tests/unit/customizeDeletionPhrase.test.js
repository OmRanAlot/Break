import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NativeModules, Switch, TextInput, Modal } from 'react-native';

NativeModules.SettingsModule = {
  saveUninstallPhrase: jest.fn(() => Promise.resolve(true)),
  enableUninstallPhrase: jest.fn(() => Promise.resolve(true)),
  requestUninstallPhraseDisable: jest.fn(),
  getUninstallPhraseDisableStatus: jest.fn(),
  confirmUninstallPhraseDisable: jest.fn(() => Promise.resolve(true)),
};
const SM = NativeModules.SettingsModule;

const DeletionPhraseSection = require('../../components/Customize/DeletionPhraseSection')
  .default;
const { normalizePhrase } = require('../../components/Customize/DeletionPhraseSection');

const PHRASE = 'DELETE BREAK NOW';
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

  it('normalizes outer whitespace like the native contract', () => {
    expect(normalizePhrase('  a b  ')).toBe('a b');
    expect(normalizePhrase(null)).toBe('');
  });

  it('rejects enabling with a blank phrase and shows an error', async () => {
    const { tree, onSaved } = await render();
    await act(async () => {
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
    expect(tree.root.findByType(Modal).props.visible).toBe(true);
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
    expect(tree.root.findByType(Modal).props.visible).toBe(false);
  });

  it('toggle is disabled and input hidden when Deletion Prevention is off', async () => {
    const { tree } = await render({ parentEnabled: false });
    expect(tree.root.findByType(Switch).props.disabled).toBe(true);
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('reloads the draft from the saved phrase', async () => {
    const { tree } = await render({ enabled: true, savedPhrase: PHRASE });
    expect(tree.root.findByType(TextInput).props.value).toBe(PHRASE);
  });

  it('shows the phrase as visible text (not a password)', async () => {
    const { tree } = await render();
    expect(tree.root.findByType(TextInput).props.secureTextEntry).toBeFalsy();
  });
});
