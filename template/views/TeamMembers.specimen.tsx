import { useState, type ReactNode } from "react";
import { Avatar, Badge, Button, Field, Select, TextInput } from "../components/index.ts";
import { defineSpecimen, type ScreenProps } from "../components/specimen.ts";
import {
  AppShell,
  DataTable,
  EmptyState,
  FormActions,
  FormLayout,
  FormSection,
  Navbar,
  PageHeader,
  SidebarNav,
} from "../patterns/index.ts";
import { initials, MEMBERS, NAV_LINKS, SIDEBAR_SECTIONS, type Member } from "../patterns/specimen-data.ts";

/*
 * A view: whole screens of one flow, built only from components and patterns.
 * Each screen gets `go(screenId, data)` to move through the flow; the gallery
 * shows one screen at a time with a strip to jump between them. A screen is
 * the whole page, shell and page padding included: nothing around it adds any.
 */

/**
 * The page every screen of this flow sits in: the product's shell, at least as tall as the window and growing
 * with the screen, so the whole page scrolls. The content keeps a readable width on a wide screen, and its side
 * padding follows the shell's width (`cqi`: the shell is a size container).
 */
function Page({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", minHeight: "100vh" }}>
      <AppShell
        contained
        navbar={
          <Navbar brand="Northwind" links={NAV_LINKS} active="team" user={{ initials: "AL", name: "Ada Lovelace" }} />
        }
        sidebar={<SidebarNav sections={SIDEBAR_SECTIONS} active="team" />}
      >
        <div
          style={{
            display: "grid",
            gap: "var(--space-6)",
            maxWidth: 1200,
            margin: "0 auto",
            padding: "var(--space-8) clamp(var(--space-4), 4cqi, var(--space-10)) var(--space-12)",
          }}
        >
          {children}
        </div>
      </AppShell>
    </div>
  );
}

const STATUS_COLOR = { Active: "success", Invited: "info", Suspended: "danger" } as const;

function MemberList({ go }: ScreenProps) {
  return (
    <Page>
      <PageHeader
        title="Members"
        description="Everyone with access to this workspace."
        actions={<Button onClick={() => go("invite")}>Invite member</Button>}
      />
      <DataTable
        caption="Workspace members"
        rows={MEMBERS}
        rowKey={(member) => member.id}
        columns={[
          {
            key: "name",
            header: "Name",
            cell: (member) => (
              <Button variant="ghost" size="sm" onClick={() => go("member", member)}>
                <Avatar initials={initials(member.name)} />
                {member.name}
              </Button>
            ),
          },
          { key: "role", header: "Role", cell: (member) => member.role },
          {
            key: "status",
            header: "Status",
            cell: (member) => <Badge color={STATUS_COLOR[member.status]}>{member.status}</Badge>,
          },
          { key: "lastActive", header: "Last active", cell: (member) => member.lastActive },
        ]}
      />
    </Page>
  );
}

function MemberDetail({ go, data }: ScreenProps) {
  const member = (data as Member | undefined) ?? MEMBERS[0]!;
  return (
    <Page>
      <PageHeader
        title={member.name}
        description={member.email}
        breadcrumbs={[{ label: "Members" }, { label: member.name }]}
        meta={<Badge color={STATUS_COLOR[member.status]}>{member.status}</Badge>}
        actions={
          <Button variant="secondary" onClick={() => go("list")}>
            Back to members
          </Button>
        }
      />
      <FormLayout onSubmit={(event) => event.preventDefault()}>
        <FormSection title="Access" description="What this member can do in the workspace.">
          <Field label="Role">
            <Select defaultValue={member.role}>
              {["Owner", "Admin", "Editor", "Viewer"].map((role) => (
                <option key={role}>{role}</option>
              ))}
            </Select>
          </Field>
        </FormSection>
        <FormActions note={`Member of ${member.projects} projects.`}>
          <Button variant="ghost" onClick={() => go("list")}>
            Cancel
          </Button>
          <Button type="submit" onClick={() => go("list")}>
            Save
          </Button>
        </FormActions>
      </FormLayout>
    </Page>
  );
}

function InviteMember({ go }: ScreenProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <Page>
        <EmptyState
          icon="users"
          title="Invitation sent"
          description={`${email} gets an email with a link to join.`}
          actions={<Button onClick={() => go("list")}>Back to members</Button>}
        />
      </Page>
    );
  }
  return (
    <Page>
      <PageHeader title="Invite a member" breadcrumbs={[{ label: "Members" }, { label: "Invite" }]} />
      <FormLayout
        onSubmit={(event) => {
          event.preventDefault();
          if (email.includes("@")) setSent(true);
        }}
      >
        <FormSection title="Who" description="They join as an editor; you can change that later.">
          <Field label="Email" hint="A work address works best.">
            <TextInput
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@company.com"
            />
          </Field>
        </FormSection>
        <FormActions>
          <Button variant="ghost" onClick={() => go("list")}>
            Cancel
          </Button>
          <Button type="submit">Send invitation</Button>
        </FormActions>
      </FormLayout>
    </Page>
  );
}

export default defineSpecimen({
  id: "team-members",
  title: "Team members",
  group: "Settings",
  description: "Browse the workspace's members, open one to change their role, or invite someone new.",
  order: 10,
  blocks: [
    {
      kind: "flow",
      screens: [
        { id: "list", label: "Member list", render: MemberList },
        { id: "member", label: "Member", render: MemberDetail },
        { id: "invite", label: "Invite", render: InviteMember },
      ],
    },
  ],
});
