# Confidential spaces

A confidential space is a space that only its members can read, for example for one-on-ones, a works council or management. In a standard space, organization and instance administrators can manage permissions and give themselves or others access. In a confidential space they cannot: they cannot open it, give anyone access or appoint its space admins.

A confidential space shows the badge **Confidential** and the note "Only its members can read it; administrators cannot give themselves access."

## Creating one

1. Create a space as usual (see [Spaces and pages](spaces-and-pages.md)).
2. Turn on **Confidential space**.
3. Add the people who get a role. Groups cannot be chosen.

Rules:

- Confidential is chosen when the space is created and cannot be changed later. A standard space cannot become confidential, and a confidential space cannot become standard.
- A confidential space is always private and cannot be made findable for people who are not its members.
- A knowledge base cannot be confidential.
- A one-on-one meeting gets its own confidential space that only the two people can open.

Who may create one: people whose organization role manages spaces, always. Other members only when both **Members create spaces** and **Members create confidential spaces** are on (both default on). The organization sets them under **Settings › Organization › Content › Spaces**; see [Spaces in the organization](../admin/spaces.md).

## What differs from a standard space

| Area | In a confidential space |
|---|---|
| Space roles | Only individual people of the organization. No groups, no "all members of the organization". |
| Sharing pages | Only with individual people, never with groups. See [Sharing and restrictions](sharing-and-restrictions.md). |
| Guests | Only the space admins invite guests or share pages with guests of the organization. Editors and organization administrators cannot, whatever the organization allows elsewhere. An invitation is held as an access request when the person who sent it is no longer space admin when the guest accepts. |
| Share links | Only **Only the people and groups you choose**, and only with individual people. Links for the organization, the instance or anyone are not possible. |
| Administrators | Organization and instance administrators cannot open the space, change its permissions or appoint its space admins. In organization lists they see it by key only, with a few numbers, never its name, members or content. |
| Owners | Only the owner and the space admins can transfer ownership; organization administrators cannot. See [Owners](owners.md). |
| Exporting the whole space or a page with its pages below | Space admins only. |
| Chat channels | The space cannot post to chat channels. |
| Audit log | Events of the space are recorded without content. People who are not members see the actor as **Hidden (confidential space)**. See [Audit log](../admin/audit-log.md). |
| Meetings | Members of a meeting series must be members of the space first. |
| Trash | The space admins also see and restore entries in second-stage recovery. A deleted confidential space can be restored only by the people who were its space admins. See [Trash and archive](trash-and-archive.md). |

## Moving and copying content

- **Into** a confidential space: the move is refused while any page shares access with groups, names groups on a restriction list, or has a link that is not limited to named people. Remove those entries and move again.
- **Out of** a confidential space: the move dialog warns "The content leaves the confidential space". After the move it is no longer protected from administrators, and the people of the target space gain access. A copy into another space shows the same kind of warning.

## When the space admin leaves

If the last active space admin is deactivated or leaves the organization while other members remain, the people who manage spaces in the organization get the notification "The confidential space … has no space admin anymore". In **Settings › Organization › Content › Spaces**, tab **All spaces**, panel **Confidential spaces**, the space shows **No space admin**, and they can select **Appoint space admin** and choose one of the remaining members. They cannot appoint themselves or anyone who is not a member, and they still cannot read the space. The appointment is recorded in the audit log.

When no active member is left at all, the space appears under **Clean up** after the waiting period set by the organization (see [Spaces in the organization](../admin/spaces.md)).

## What the protection does not cover

The protection applies to roles in Lunedo. Administrators of the server with access to the database or backups are not restricted by it. An administrator can reset the sign-in of a member; every such reset is recorded in the audit log.
