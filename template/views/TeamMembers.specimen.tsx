import { useState } from "react";
import { Avatar, Badge, Button, Field, Select, TextInput } from "../components/index.ts";
import { defineSpecimen, type ScreenProps } from "../components/specimen.ts";
import { DataTable, EmptyState, FormActions, FormLayout, FormSection, PageHeader } from "../patterns/index.ts";
import { initials, MEMBERS, type Member } from "../patterns/specimen-data.ts";

/*
 * A view: whole screens of one flow, built only from components and patterns.
 * Each screen gets `go(screenId, data)` to move through the flow; the gallery
 * shows one screen at a time with a strip to jump between them.
 */

const STATUS_COLOR = { Active: "success", Invited: "info", Suspended: "danger" } as const;

function MemberList({ go }: ScreenProps) {
  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
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
    </div>
  );
}

function MemberDetail({ go, data }: ScreenProps) {
  const member = (data as Member | undefined) ?? MEMBERS[0]!;
  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
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
    </div>
  );
}

function InviteMember({ go }: ScreenProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  if (sent) {
    return (
      <EmptyState
        icon="users"
        title="Invitation sent"
        description={`${email} gets an email with a link to join.`}
        actions={<Button onClick={() => go("list")}>Back to members</Button>}
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
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
    </div>
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
