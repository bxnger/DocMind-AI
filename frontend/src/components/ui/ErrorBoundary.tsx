import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
}

/** Keeps a failure in one region (viewer, chat) from blanking the whole app. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Region crashed', error, info.componentStack);
  }

  override render() {
    return this.state.failed ? this.props.fallback(() => this.setState({ failed: false })) : this.props.children;
  }
}
