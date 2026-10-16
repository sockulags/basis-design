/**
 * What the Basis gallery needs from each component in the workspace.
 *
 * Components in workspace/components may look and behave however the design
 * calls for and may accept more props than listed here, but they must export
 * every component below and accept at least these props, because the gallery
 * renders each one in every state through this interface. Basis type-checks
 * the workspace against this file after every agent turn.
 *
 * This file is copied into the workspace as .basis/contracts.ts, so it may only
 * import from "react".
 */
import type {
  ButtonHTMLAttributes,
  ComponentType,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/** Pseudo-states the gallery pins on a component (rendered as data-force) so every state is visible at once. */
export type ForcedState = "hover" | "focus" | "active";
export type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";
export type StatusTone = "info" | "success" | "warning" | "danger";
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  force?: ForcedState;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export interface FieldControlProps {
  force?: "hover" | "focus";
  invalid?: boolean;
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & FieldControlProps;
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldControlProps;
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldControlProps;

export interface ControlProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  force?: "hover" | "focus";
}

export interface CheckboxProps extends ControlProps {
  indeterminate?: boolean;
}

export interface BadgeProps {
  color?: Tone;
  variant?: "soft" | "solid" | "outline";
  children: ReactNode;
}

export interface StatusIconProps {
  tone: StatusTone;
}

export interface AlertProps {
  tone: StatusTone;
  title: string;
  children: ReactNode;
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  selected?: boolean;
  force?: "hover" | "focus";
}

export interface ProgressProps {
  /** Omitted means indeterminate. */
  value?: number;
}

export interface SpinnerProps {
  size?: number;
}

export interface SkeletonProps {
  width: number | string;
  height?: number;
  round?: boolean;
}

export interface AvatarProps {
  initials: string;
  tone?: Tone;
}

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
  force?: "hover" | "focus";
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange?: (id: string) => void;
  /** components.tabs.variant from design-system.json. */
  variant: string;
  label: string;
}

export interface TooltipProps {
  text: string;
  children: ReactNode;
  /** Pinned open for the gallery. */
  open?: boolean;
}

export interface ToastProps {
  tone: StatusTone;
  title: string;
  children: ReactNode;
  action?: string;
  animate?: "enter" | "exit";
  onClose?: () => void;
}

export interface DialogStageProps {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  /** Play the enter animation. */
  animate?: boolean;
}

export interface Contracts {
  Button: ComponentType<ButtonProps>;
  Field: ComponentType<FieldProps>;
  TextInput: ComponentType<TextInputProps>;
  Textarea: ComponentType<TextareaProps>;
  Select: ComponentType<SelectProps>;
  Checkbox: ComponentType<CheckboxProps>;
  Radio: ComponentType<ControlProps>;
  Switch: ComponentType<ControlProps>;
  Badge: ComponentType<BadgeProps>;
  StatusIcon: ComponentType<StatusIconProps>;
  Alert: ComponentType<AlertProps>;
  Card: ComponentType<CardProps>;
  Progress: ComponentType<ProgressProps>;
  Spinner: ComponentType<SpinnerProps>;
  Skeleton: ComponentType<SkeletonProps>;
  Avatar: ComponentType<AvatarProps>;
  Tabs: ComponentType<TabsProps>;
  Tooltip: ComponentType<TooltipProps>;
  Toast: ComponentType<ToastProps>;
  DialogStage: ComponentType<DialogStageProps>;
}

export const CONTRACT_EXPORTS: (keyof Contracts)[] = [
  "Button",
  "Field",
  "TextInput",
  "Textarea",
  "Select",
  "Checkbox",
  "Radio",
  "Switch",
  "Badge",
  "StatusIcon",
  "Alert",
  "Card",
  "Progress",
  "Spinner",
  "Skeleton",
  "Avatar",
  "Tabs",
  "Tooltip",
  "Toast",
  "DialogStage",
];
