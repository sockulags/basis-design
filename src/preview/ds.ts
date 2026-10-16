import * as workspace from "@ds";
import type { Contracts } from "../../shared/contracts.ts";

/**
 * The workspace's components, typed by their contracts. "@ds" resolves to
 * workspace/components at runtime (see the preview Vite config); the agent can
 * rewrite those files, so a missing export shows up as a section error in the
 * gallery rather than a crash of the whole preview.
 */
const ds = workspace as unknown as Contracts;

export const {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  DialogStage,
  Field,
  Progress,
  Radio,
  Select,
  Skeleton,
  Spinner,
  StatusIcon,
  Switch,
  Tabs,
  Textarea,
  TextInput,
  Toast,
  Tooltip,
} = ds;
