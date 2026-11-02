import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import DeletionDisablePauseModal, {
  DISABLE_PAUSE_MS,
  formatDeletionCountdown,
} from '../../components/Customize/DeletionDisablePauseModal';

describe('DeletionDisablePauseModal', () => {
  let appStateListener;
  let addEventListenerSpy;
  let originalCurrentState;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-14T12:00:00Z'));
    originalCurrentState = Object.getOwnPropertyDescriptor(
      AppState,
      'currentState',
    );
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener;
        return { remove: jest.fn() };
      });
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    Object.defineProperty(AppState, 'currentState', originalCurrentState);
    jest.useRealTimers();
  });

  const renderModal = async (props = {}) => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    let renderer;
    await act(() => {
      renderer = ReactTestRenderer.create(
        <DeletionDisablePauseModal
          visible
          onCancel={onCancel}
          onConfirm={onConfirm}
          {...props}
        />,
      );
    });
    return { renderer, onCancel, onConfirm };
  };

  const countdown = renderer =>
    renderer.root
      .findByProps({ accessibilityRole: 'timer' })
      .props.accessibilityLabel.replace(' remaining', '');

  const turnOffButton = renderer =>
    renderer.root.findByProps({
      accessibilityLabel: 'Turn off deletion prevention',
    });

  it('formats countdown values as M:SS', () => {
    expect(formatDeletionCountdown(300)).toBe('5:00');
    expect(formatDeletionCountdown(59)).toBe('0:59');
    expect(formatDeletionCountdown(0)).toBe('0:00');
  });

  it('requires the full five minutes and a final tap', async () => {
    const { renderer, onConfirm } = await renderModal();
    expect(countdown(renderer)).toBe('5:00');
    expect(turnOffButton(renderer).props.disabled).toBe(true);

    await act(() => jest.advanceTimersByTime(DISABLE_PAUSE_MS - 1000));
    expect(countdown(renderer)).toBe('0:01');
    expect(turnOffButton(renderer).props.disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();

    await act(() => jest.advanceTimersByTime(1000));
    expect(countdown(renderer)).toBe('0:00');
    expect(turnOffButton(renderer).props.disabled).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();

    await act(() => turnOffButton(renderer).props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('resets the full wait after the app leaves the foreground', async () => {
    const { renderer } = await renderModal();

    await act(() => jest.advanceTimersByTime(2 * 60 * 1000));
    expect(countdown(renderer)).toBe('3:00');

    await act(() => appStateListener('background'));
    expect(countdown(renderer)).toBe('5:00');
    expect(turnOffButton(renderer).props.disabled).toBe(true);

    await act(() => appStateListener('active'));
    await act(() => jest.advanceTimersByTime(DISABLE_PAUSE_MS));
    expect(countdown(renderer)).toBe('0:00');
    expect(turnOffButton(renderer).props.disabled).toBe(false);
  });

  it('starts over whenever the modal is reopened', async () => {
    const { renderer, onCancel, onConfirm } = await renderModal();
    await act(() => jest.advanceTimersByTime(DISABLE_PAUSE_MS));
    expect(turnOffButton(renderer).props.disabled).toBe(false);

    await act(() => {
      renderer.update(
        <DeletionDisablePauseModal
          visible={false}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      );
    });
    await act(() => {
      renderer.update(
        <DeletionDisablePauseModal
          visible
          onCancel={onCancel}
          onConfirm={onConfirm}
        />,
      );
    });

    expect(countdown(renderer)).toBe('5:00');
    expect(turnOffButton(renderer).props.disabled).toBe(true);
  });
});
