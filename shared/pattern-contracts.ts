/**
 * The baseline API of the starter patterns: what every design system made with
 * Basis keeps, so views and other patterns can build on them.
 *
 * Patterns in workspace/patterns may change how they look and behave and may
 * accept more props, but they must export everything below and accept at least
 * these props. Basis type-checks the workspace against this file after every
 * agent turn; patterns the design system adds have their contracts in
 * patterns/contracts.ts.
 *
 * Icon names belong to the workspace's own icon set, so the contracts take them
 * as a type parameter (`IconName` from patterns/icons.tsx).
 *
 * This file is copied into the workspace as .basis/pattern-contracts.ts, so it
 * may only import from "react".
 */
import type { ComponentType, FormHTMLAttributes, ReactNode, SVGProps } from "react";

export interface AppShellProps {
  navbar?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
  /** Fills its container instead of the viewport. */
  contained?: boolean;
}

export type SortDirection = "asc" | "desc";

export interface ChatThreadProps {
  children?: ReactNode;
  composer: ReactNode;
  empty?: ReactNode;
  header?: ReactNode;
}

export interface ChatMessageProps {
  role: "user" | "assistant";
  children?: ReactNode;
  author?: string;
  avatar?: ReactNode;
  time?: string;
  status?: "done" | "streaming" | "error";
  error?: string;
  onRetry?: () => void;
  actions?: ReactNode;
  attachments?: ComposerAttachment[];
}

export interface ChatSuggestion<IconName extends string> {
  id: string;
  label: string;
  description?: string;
  icon?: IconName;
}

export interface ChatWelcomeProps<IconName extends string> {
  title: string;
  description?: string;
  suggestions?: ChatSuggestion<IconName>[];
  onSuggestion?: (id: string) => void;
}

export interface ComposerAttachment {
  id: string;
  name: string;
  meta?: string;
  uploading?: boolean;
}

export interface ComposerProps {
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (text: string) => void;
  placeholder?: string;
  label?: string;
  attachments?: ComposerAttachment[];
  onAttach?: () => void;
  onRemoveAttachment?: (id: string) => void;
  busy?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  tools?: ReactNode;
  footer?: ReactNode;
}

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
  width?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  sort?: { key: string; direction: SortDirection };
  onSortChange?: (sort: { key: string; direction: SortDirection }) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (keys: string[]) => void;
  loading?: boolean;
  empty?: ReactNode;
  density?: "comfortable" | "compact";
  footer?: ReactNode;
}

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  summary?: ReactNode;
}

export interface EmptyStateProps<IconName extends string> {
  icon?: IconName;
  title: string;
  description?: string;
  actions?: ReactNode;
  tone?: "neutral" | "danger";
  compact?: boolean;
}

export interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export interface FormActionsProps {
  children: ReactNode;
  note?: ReactNode;
}

export type FormLayoutProps = FormHTMLAttributes<HTMLFormElement> & { children: ReactNode };

export interface NavbarLink {
  id: string;
  label: string;
  href?: string;
}

export interface NavbarProps {
  brand: ReactNode;
  links: NavbarLink[];
  active?: string;
  onNavigate?: (id: string) => void;
  searchPlaceholder?: string;
  actions?: ReactNode;
  user?: { initials: string; name: string };
}

export interface Crumb {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: Crumb[];
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}

export interface SidebarNavItem<IconName extends string> {
  id: string;
  label: string;
  icon?: IconName;
  badge?: string | number;
  disabled?: boolean;
}

export interface SidebarNavSection<IconName extends string> {
  title?: string;
  items: SidebarNavItem<IconName>[];
}

export interface SidebarNavProps<IconName extends string> {
  sections: SidebarNavSection<IconName>[];
  active?: string;
  onNavigate?: (id: string) => void;
  header?: ReactNode;
  footer?: ReactNode;
  collapsed?: boolean;
}

export interface StatCardProps {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down" | "flat"; good?: boolean };
  hint?: string;
  trend?: number[];
  loading?: boolean;
}

export type IconProps<IconName extends string> = { name: IconName; size?: number } & Omit<
  SVGProps<SVGSVGElement>,
  "name"
>;

export interface PatternContracts<IconName extends string> {
  AppShell: ComponentType<AppShellProps>;
  ChatThread: ComponentType<ChatThreadProps>;
  ChatMessage: ComponentType<ChatMessageProps>;
  ChatWelcome: ComponentType<ChatWelcomeProps<IconName>>;
  Composer: ComponentType<ComposerProps>;
  /** Generic over the row type, so a table keeps its rows typed. */
  DataTable: <T>(props: DataTableProps<T>) => ReactNode;
  Pagination: ComponentType<PaginationProps>;
  EmptyState: ComponentType<EmptyStateProps<IconName>>;
  FormSection: ComponentType<FormSectionProps>;
  FormActions: ComponentType<FormActionsProps>;
  FormLayout: ComponentType<FormLayoutProps>;
  Navbar: ComponentType<NavbarProps>;
  Breadcrumbs: ComponentType<BreadcrumbsProps>;
  PageHeader: ComponentType<PageHeaderProps>;
  SidebarNav: ComponentType<SidebarNavProps<IconName>>;
  StatCard: ComponentType<StatCardProps>;
  Icon: ComponentType<IconProps<IconName>>;
}
