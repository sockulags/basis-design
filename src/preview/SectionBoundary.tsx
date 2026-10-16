import { Component, type ErrorInfo, type ReactNode } from "react";
import { describe, onHotUpdate, setProblem } from "./errors.ts";

interface Props {
  name: string;
  onAsk: (prefix: string) => void;
  children: ReactNode;
}

/**
 * Keeps one broken component from blanking the whole gallery. After every hot
 * update the boundary renders its section again, so a fix shows up (and the
 * reported problem clears) without reloading the preview.
 */
export class SectionBoundary extends Component<Props, { error: unknown }> {
  state: { error: unknown } = { error: null };
  private stopListening?: () => void;

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {
    // Reported from the lifecycle below, which also covers StrictMode's simulated remounts.
  }

  componentDidMount() {
    this.stopListening = onHotUpdate(() => {
      if (this.state.error) this.setState({ error: null });
    });
    this.report();
  }

  componentDidUpdate() {
    this.report();
  }

  componentWillUnmount() {
    this.stopListening?.();
    setProblem(`${this.props.name} section`, null);
  }

  private report() {
    setProblem(`${this.props.name} section`, this.state.error ? describe(this.state.error) : null);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const message = describe(error);
    return (
      <div className="section-error" role="alert">
        <strong>{this.props.name} failed to render</strong>
        <code>{message}</code>
        <button type="button" className="ask-button" onClick={() => this.props.onAsk(`The ${this.props.name} section fails to render (${message}). Fix it. `)}>
          Ask agent to fix
        </button>
      </div>
    );
  }
}
