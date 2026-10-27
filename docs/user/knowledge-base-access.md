# Knowledge base access

Who may edit a knowledge base is set with roles under **Space settings › Access › Permissions**, as in every space. Who may read it is set with its **audience**. Areas, topics and articles can narrow the audience with view restrictions; they can never widen it.

## Audience

| Audience | Readers in Lunedo | Readers in the portal |
|---|---|---|
| Public | every internal user of the instance | everyone, also without signing in |
| All signed-in people (default) | every internal user of the instance | the same |
| Specific groups | members of the chosen groups, and holders of other roles | the same |
| Portal accounts | only holders of a role | portal accounts invited to this knowledge base, and holders of a role |

Guests read a knowledge base only when they hold a role. Shares of single articles and share links work as in every other space (see [Sharing and restrictions](sharing-and-restrictions.md)), except for portal accounts.

A public knowledge base can be found by search engines, and they may keep public articles for a while after you restrict the knowledge base again. Only a public knowledge base can be downloaded as a [static website](knowledge-base-static-website.md).

### Changing the audience

1. Open **Space settings › Publishing › Visibility**. Only space admins change it.
2. Choose the audience under **Who may read it**. For **Specific groups**, search the groups by name.
3. Click **Save visibility**.

A change that lets more people read, for example from groups to all signed-in people, to public, or adding a group, asks first: **Let more people read …?** names the number of articles without a view restriction that become readable. Confirm with **Allow reading**. Narrowing saves without asking. Every change is recorded in the [audit log](../admin/audit-log.md) as `knowledgeBase.audienceChanged`.

## Portal accounts

Portal accounts are for readers without an account of the organization, for example customers. They read only knowledge bases whose audience is **Portal accounts**, and never see the wiki.

### Inviting a reader

People who may manage the organization's members invite portal accounts: organization owners and administrators, or a custom role with the permission to manage members and groups. Being space admin of the knowledge base is not enough, because a portal account joins the organization.

1. Set the audience of the knowledge base to **Portal accounts** (see [Changing the audience](#changing-the-audience)).
2. Open **Space settings › Publishing › Portal accounts**.
3. Click **Invite reader**, enter the **E-mail address** and, optionally, **Access until**.
4. Click **Send invitation**.

The invitation e-mail links to a page where the reader chooses a name and a password; afterwards the link leads to the portal. The link works once and for 7 days. **Open invitations** lists invitations not yet accepted; **Withdraw invitation** stops the link. A new portal invitation replaces only an earlier portal invitation for the same address and knowledge base; open member invitations stay valid.

An address that already belongs to another Lunedo account cannot accept the invitation; give that account a role in the knowledge base instead.

The person who invites is responsible for the account and is reminded before its access ends, as for guests. When the date is reached, the access ends and the account no longer reads the organization's knowledge bases.

### What a portal account can do

- It signs in with its e-mail address and password, and can add a passkey and an authenticator app on its own page.
- It reads the portals of the knowledge bases it was invited to and of knowledge bases where it holds a role, never every knowledge base of the organization. Opening the wiki shows only **Your help portals**, the list of its portals, and its sign-in settings.
- It only reads. A role above Reader for a portal account is refused, and a higher role through a group counts as Reader for it, in every path.
- It never reads through shares or links, and never in other spaces, whatever its roles say.

### Managing portal accounts

**Space settings › Publishing › Portal accounts** lists the portal accounts invited to this knowledge base, with the end of their access and their last sign-in.

- **Deactivate** ends all sessions of the account at once and blocks its sign-in. An instance administrator, or an administrator of every organization the account belongs to, can reactivate it.
- **Remove from organization** ends its access to every knowledge base of the organization. Invite it again to give it access back.

An account that also reads knowledge bases of other organizations can only be removed from this organization, not deactivated. Organization administrators can do the same in the member list. Invitations, acceptances, deactivations and the end of access are recorded in the [audit log](../admin/audit-log.md), for example as `portalAccount.invited`.

## Access per area and topic

Every folder has two access settings. Open them with **Access…** in the **…** menu of the folder in the tree, or with the button on the folder page. Only space admins of the knowledge base change them; organization administrators first become space admin of it.

- **Responsible** names one or more groups. They create, edit, publish, move and delete the articles in the folder and everything below it. Space admins always can. Without a group, everyone with the role Editor writes there. When every group of a folder is deleted, only space admins write there until new groups are set.
- **Visible to** is **Like the knowledge base** or **Only certain groups**. It is a view restriction of the folder and applies everywhere content is read: the portal with its pages, search, area lists, counts and feedback; the app with its tree, search, **For you** and notifications; the article API, includes and exports. A restricted folder is never part of the static website. Space admins see that it exists and can change or remove the restriction without reading its content.

A topic can only name groups of the folder above it, for both settings. The sharing dialog of pages does not change folders of a knowledge base.

### Changing who maintains and who sees a folder

1. Open **Access…** of the folder.
2. Add or remove groups under **Responsible**, and choose **Visible to**. The dialog says how many articles and topics the change applies to.
3. Read **What changes**: who can only read the articles afterwards, how many people lose or gain read access, and whether the folder disappears from the public portal and the static website.
4. Click **Save access**. A change that lets more people read asks for confirmation with the number of articles.

Every change is recorded in the [audit log](../admin/audit-log.md) as `knowledgeBase.categoryAccessChanged`. Moving an article between folders with different responsible groups asks for confirmation, like every move that changes access.

### Mine and All

People responsible for at least one area see **Mine** and **All** above the tree. **Mine**, the default for them, shows only the areas that contain their folders and says how many further areas they can read; **All** shows every area. The choice is stored with your preferences. It filters the view and grants nothing.

Search in the app finds every article you may read and marks articles in folders you cannot change as **other category · read only**.
