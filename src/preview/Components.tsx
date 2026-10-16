import { useState } from "react";
import type { Design } from "../../shared/design.ts";
import { Button, type ButtonVariant } from "../ds/Button.tsx";
import { Checkbox, Radio, Switch } from "../ds/Controls.tsx";
import { Alert, Avatar, Badge, Card, Progress, Skeleton, Spinner, type Tone } from "../ds/Display.tsx";
import { Field, Select, Textarea, TextInput } from "../ds/Field.tsx";
import { DialogStage, Toast, Tooltip } from "../ds/Overlay.tsx";
import { Tabs } from "../ds/Tabs.tsx";
import type { ForcedState } from "../ds/util.ts";
import styles from "./Components.module.css";
import { Grid, Group, Matrix, Row, Section, Specimen, type Axis } from "./Gallery.tsx";

interface SectionProps {
  design: Design;
  onAsk: (prefix: string) => void;
}

type ButtonState = "default" | ForcedState | "disabled" | "loading";

const BUTTON_VARIANTS: Axis<ButtonVariant>[] = [
  { id: "primary", label: "primary" },
  { id: "secondary", label: "secondary" },
  { id: "outline", label: "outline" },
  { id: "ghost", label: "ghost" },
  { id: "danger", label: "danger" },
];

const BUTTON_STATES: Axis<ButtonState>[] = [
  { id: "default", label: "default" },
  { id: "hover", label: "hover" },
  { id: "active", label: "pressed" },
  { id: "focus", label: "focus-visible" },
  { id: "disabled", label: "disabled" },
  { id: "loading", label: "loading" },
];

export function Buttons({ onAsk }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const runBusy = () => {
    setBusy(true);
    setTimeout(() => setBusy(false), 1600);
  };
  return (
    <Section
      id="buttons"
      title="Buttons"
      description="Five variants in every interaction state. Hover, pressed and focus are pinned so you can compare them side by side."
      onAsk={onAsk}
    >
      <Matrix
        rows={BUTTON_VARIANTS}
        cols={BUTTON_STATES}
        render={(variant, state) => (
          <Button
            variant={variant}
            force={state === "hover" || state === "active" || state === "focus" ? state : undefined}
            disabled={state === "disabled"}
            loading={state === "loading"}
          >
            Continue
          </Button>
        )}
      />
      <Group title="Sizes">
        <Row>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="sm" variant="outline">
            Small
          </Button>
          <Button size="md" variant="outline">
            Medium
          </Button>
          <Button size="lg" variant="outline">
            Large
          </Button>
        </Row>
      </Group>
      <Group title="Live · hover, press, tab to focus">
        <Row>
          <Button onClick={runBusy} loading={busy}>
            Save changes
          </Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="outline">Preview</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Delete project</Button>
        </Row>
      </Group>
    </Section>
  );
}

export function Inputs({ onAsk }: SectionProps) {
  return (
    <Section
      id="inputs"
      title="Inputs"
      description="Text fields, select and textarea through every state they can be in: resting, hovered, focused, filled, invalid, disabled and read-only."
      onAsk={onAsk}
    >
      <Group title="Text input states">
        <Grid min={200}>
          <Field label="Default" hint="Helper text sits here">
            <TextInput placeholder="name@company.com" />
          </Field>
          <Field label="Hover">
            <TextInput placeholder="name@company.com" force="hover" />
          </Field>
          <Field label="Focus">
            <TextInput placeholder="name@company.com" force="focus" />
          </Field>
          <Field label="Filled">
            <TextInput defaultValue="ada@lovelace.dev" />
          </Field>
          <Field label="Invalid" error="Enter a valid email address">
            <TextInput defaultValue="ada@" invalid />
          </Field>
          <Field label="Invalid + focus" error="Enter a valid email address">
            <TextInput defaultValue="ada@" invalid force="focus" />
          </Field>
          <Field label="Disabled">
            <TextInput placeholder="Not editable" disabled />
          </Field>
          <Field label="Read-only">
            <TextInput defaultValue="ws_4f9a21" readOnly />
          </Field>
        </Grid>
      </Group>
      <Group title="Select & textarea">
        <Grid min={240}>
          <Field label="Select">
            <Select defaultValue="team">
              <option value="solo">Solo</option>
              <option value="team">Team</option>
              <option value="org">Organisation</option>
            </Select>
          </Field>
          <Field label="Select · focus">
            <Select defaultValue="team" force="focus">
              <option value="team">Team</option>
            </Select>
          </Field>
          <Field label="Select · disabled">
            <Select defaultValue="team" disabled>
              <option value="team">Team</option>
            </Select>
          </Field>
          <Field label="Textarea" hint="Markdown is supported">
            <Textarea placeholder="Tell us about your project…" />
          </Field>
          <Field label="Textarea · invalid" error="Please write at least 20 characters">
            <Textarea defaultValue="Too short" invalid />
          </Field>
        </Grid>
      </Group>
    </Section>
  );
}

type ControlState = "default" | "hover" | "focus" | "disabled";
type ControlKind = "checkOff" | "checkOn" | "checkMixed" | "radioOff" | "radioOn" | "switchOff" | "switchOn";

const CONTROL_ROWS: Axis<ControlKind>[] = [
  { id: "checkOff", label: "checkbox" },
  { id: "checkOn", label: "checked" },
  { id: "checkMixed", label: "indeterminate" },
  { id: "radioOff", label: "radio" },
  { id: "radioOn", label: "selected" },
  { id: "switchOff", label: "switch off" },
  { id: "switchOn", label: "switch on" },
];

const CONTROL_STATES: Axis<ControlState>[] = [
  { id: "default", label: "default" },
  { id: "hover", label: "hover" },
  { id: "focus", label: "focus-visible" },
  { id: "disabled", label: "disabled" },
];

export function Selection({ onAsk }: SectionProps) {
  const [notify, setNotify] = useState(true);
  const [plan, setPlan] = useState("monthly");
  return (
    <Section
      id="selection"
      title="Selection controls"
      description="Checkbox, radio and switch, including indeterminate. Toggle the live row to feel the transition."
      onAsk={onAsk}
    >
      <Matrix
        rows={CONTROL_ROWS}
        cols={CONTROL_STATES}
        minCol={90}
        render={(kind, state) => {
          const props = {
            force: state === "hover" || state === "focus" ? state : undefined,
            disabled: state === "disabled",
            readOnly: true,
            "aria-label": `${kind} ${state}`,
          } as const;
          if (kind.startsWith("check"))
            return <Checkbox {...props} checked={kind !== "checkOff"} indeterminate={kind === "checkMixed"} />;
          if (kind.startsWith("radio")) return <Radio {...props} checked={kind === "radioOn"} />;
          return <Switch {...props} checked={kind === "switchOn"} />;
        }}
      />
      <Group title="Live">
        <Row>
          <Switch label="Email notifications" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
          <Checkbox label="Remember me" defaultChecked />
          <Radio label="Monthly" name="plan" checked={plan === "monthly"} onChange={() => setPlan("monthly")} />
          <Radio label="Yearly" name="plan" checked={plan === "yearly"} onChange={() => setPlan("yearly")} />
        </Row>
      </Group>
    </Section>
  );
}

const TONES: Axis<Tone>[] = [
  { id: "neutral", label: "neutral" },
  { id: "primary", label: "primary" },
  { id: "info", label: "info" },
  { id: "success", label: "success" },
  { id: "warning", label: "warning" },
  { id: "danger", label: "danger" },
];

export function Feedback({ onAsk }: SectionProps) {
  const [toastKey, setToastKey] = useState(0);
  const [toastPhase, setToastPhase] = useState<"enter" | "exit" | null>(null);
  const showToast = () => {
    setToastKey((key) => key + 1);
    setToastPhase("enter");
  };
  return (
    <Section
      id="feedback"
      title="Feedback & status"
      description="Badges, alerts, toasts and loading states across the four status tones."
      onAsk={onAsk}
    >
      <Group title="Badges">
        <Matrix
          rows={[
            { id: "soft", label: "soft" },
            { id: "solid", label: "solid" },
            { id: "outline", label: "outline" },
          ]}
          cols={TONES}
          minCol={80}
          render={(variant, color) => (
            <Badge variant={variant} color={color}>
              {color === "neutral" ? "Draft" : color === "primary" ? "New" : color === "info" ? "Beta" : color === "success" ? "Live" : color === "warning" ? "Pending" : "Failed"}
            </Badge>
          )}
        />
      </Group>
      <Group title="Alerts">
        <div className={styles.stack}>
          <Alert tone="info" title="Scheduled maintenance">
            The API will be read-only on Sunday between 02:00 and 03:00 UTC.
          </Alert>
          <Alert tone="success" title="Deployment finished">
            Version 2.4.0 is live on all regions.
          </Alert>
          <Alert tone="warning" title="Approaching your quota">
            You have used 86% of this month's build minutes.
          </Alert>
          <Alert tone="danger" title="Payment failed">
            We could not charge the card ending in 4242. Update it to keep your workspace active.
          </Alert>
        </div>
      </Group>
      <Group
        title="Toasts"
        actions={
          <Button size="sm" variant="secondary" onClick={showToast}>
            Play enter
          </Button>
        }
      >
        <div className={styles.toastStage}>
          <Toast tone="success" title="Invite sent" action="Undo">
            Maya will get an email with a link to join.
          </Toast>
          {toastPhase && (
            <Toast
              key={toastKey}
              tone="danger"
              title="Couldn't save draft"
              animate={toastPhase}
              onClose={() => setToastPhase("exit")}
            >
              Check your connection and try again.
            </Toast>
          )}
        </div>
      </Group>
      <Group title="Loading">
        <Grid min={200}>
          <Specimen label="progress 35%">
            <div className={styles.fill}>
              <Progress value={35} />
            </div>
          </Specimen>
          <Specimen label="progress 80%">
            <div className={styles.fill}>
              <Progress value={80} />
            </div>
          </Specimen>
          <Specimen label="indeterminate">
            <div className={styles.fill}>
              <Progress />
            </div>
          </Specimen>
          <Specimen label="spinner">
            <Row>
              <Spinner size={16} />
              <Spinner size={24} />
              <Spinner size={32} />
            </Row>
          </Specimen>
        </Grid>
        <Card>
          <div className={styles.skeletonCard}>
            <Skeleton width={40} height={40} round />
            <div className={styles.skeletonLines}>
              <Skeleton width="45%" height={14} />
              <Skeleton width="90%" />
              <Skeleton width="70%" />
            </div>
          </div>
        </Card>
      </Group>
    </Section>
  );
}

export function Navigation({ design, onAsk }: SectionProps) {
  const [tab, setTab] = useState("overview");
  const variant = design.components.tabs.variant;
  return (
    <Section
      id="navigation"
      title="Tabs"
      description={`Current variant: ${variant}. Use the arrow keys in the live tabs to move focus.`}
      onAsk={onAsk}
    >
      <Group title="States · selected, hover, focus-visible, disabled">
        <Tabs
          label="Tab states"
          variant={variant}
          value="overview"
          items={[
            { id: "overview", label: "Overview" },
            { id: "activity", label: "Activity", force: "hover" },
            { id: "members", label: "Members", force: "focus" },
            { id: "billing", label: "Billing", disabled: true },
          ]}
        />
      </Group>
      <Group title="Live">
        <Tabs
          label="Project sections"
          variant={variant}
          value={tab}
          onChange={setTab}
          items={[
            { id: "overview", label: "Overview" },
            { id: "activity", label: "Activity" },
            { id: "members", label: "Members" },
            { id: "settings", label: "Settings" },
          ]}
        />
      </Group>
    </Section>
  );
}

export function Surfaces({ onAsk }: SectionProps) {
  const [selected, setSelected] = useState("pro");
  const plans = [
    { id: "starter", name: "Starter", price: "Free", copy: "For side projects and trying things out." },
    { id: "pro", name: "Pro", price: "€12 / mo", copy: "Unlimited projects and version history." },
    { id: "team", name: "Team", price: "€29 / mo", copy: "Shared libraries, roles and review flows." },
  ];
  return (
    <Section
      id="surfaces"
      title="Cards"
      description="Static, hovered, focused and selected surfaces, then a live picker that lifts on hover."
      onAsk={onAsk}
    >
      <Grid min={200}>
        {(
          [
            ["default", {}],
            ["hover", { interactive: true, force: "hover" }],
            ["focus-visible", { interactive: true, force: "focus" }],
            ["selected", { selected: true }],
          ] as const
        ).map(([label, props]) => (
          <Specimen key={label} label={label}>
            <Card {...props} className={styles.fill}>
              <div className={styles.cardHead}>
                <Avatar initials="AL" />
                <div>
                  <p className={styles.cardTitle}>Ada Lovelace</p>
                  <p className={styles.cardMeta}>Analyst · London</p>
                </div>
              </div>
            </Card>
          </Specimen>
        ))}
      </Grid>
      <Group title="Live">
        <Grid min={200}>
          {plans.map((plan) => (
            <Card
              key={plan.id}
              interactive
              selected={selected === plan.id}
              onClick={() => setSelected(plan.id)}
              onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && setSelected(plan.id)}
              role="radio"
              aria-checked={selected === plan.id}
            >
              <div className={styles.planHead}>
                <p className={styles.cardTitle}>{plan.name}</p>
                {plan.id === "pro" && (
                  <Badge color="primary" variant="soft">
                    Popular
                  </Badge>
                )}
              </div>
              <p className={styles.planPrice}>{plan.price}</p>
              <p className={styles.cardMeta}>{plan.copy}</p>
            </Card>
          ))}
        </Grid>
      </Group>
    </Section>
  );
}

export function Overlays({ onAsk }: SectionProps) {
  const [replay, setReplay] = useState(0);
  return (
    <Section
      id="overlays"
      title="Tooltips & dialogs"
      description="Floating layers. Hover the live tooltip; replay the dialog to judge its enter motion."
      onAsk={onAsk}
    >
      <Group title="Tooltip · static and live">
        <Row>
          <div className={styles.tooltipSlot}>
            <Tooltip text="Copied to clipboard" open>
              <Button variant="secondary">Static</Button>
            </Tooltip>
          </div>
          <div className={styles.tooltipSlot}>
            <Tooltip text="Opens in a new tab">
              <Button variant="outline">Hover me</Button>
            </Tooltip>
          </div>
        </Row>
      </Group>
      <Group
        title="Dialog"
        actions={
          <Button size="sm" variant="secondary" onClick={() => setReplay((value) => value + 1)}>
            Replay enter
          </Button>
        }
      >
        <DialogStage
          key={replay}
          animate={replay > 0}
          title="Archive this project?"
          footer={
            <>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Archive</Button>
            </>
          }
        >
          Archived projects stay readable for 30 days. After that, their history is removed for good.
        </DialogStage>
      </Group>
    </Section>
  );
}
