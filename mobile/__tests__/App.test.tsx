import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import App from '../App';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({children}: {children: React.ReactNode}) => children,
  SafeAreaView: ({children}: {children: React.ReactNode}) => children,
}));
jest.mock('../src/utils/token', () => ({
  getToken: jest.fn(async () => null),
  verifyToken: jest.fn(),
  getProfile: jest.fn(async () => ({email: 'test@example.com'})),
}));
test('shows the mobile sign-in form, not the old capture lab', async () => {
  let renderer: Renderer.ReactTestRenderer;
  await act(async () => {
    renderer = Renderer.create(<App />);
  });
  const output = JSON.stringify(renderer!.toJSON());
  expect(output).toContain('欢迎回来');
  expect(output).toContain('验证码登录');
  expect(output).not.toContain('Audio Capture Lab');
  await act(async () => renderer!.unmount());
});
