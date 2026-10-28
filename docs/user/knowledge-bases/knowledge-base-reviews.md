# Knowledge base reviews

Articles get outdated. A knowledge base can ask for regular reviews, so that someone checks each article from time to time. Reviews are off by default.

## Setting the interval

Space admins set the review settings under **Space settings › Content › Review**:

| Setting | Values | Default |
|---|---|---|
| **Review interval** | No review, every 3, 6 or 12 months | No review |
| **First reminder** | Only on the due date, 7, 14 or 30 days before | 14 days before |
| **Who is reminded** | The owner, or the owner and the space admins | The owner |

The interval applies to every article without an interval of its own. **Changed source page** is always on: an article whose source page changed is listed under **Review**.

Editors give an article its own interval, or switch reviews off for it, at the top of the article next to **Review:**. **Same as the knowledge base** returns to the interval of the knowledge base. There is no interval per area or topic.

An article is due when its interval has passed since its last review, or since it was first published when it was never reviewed. Unpublished articles are never due. Changing an interval, reviewing an article, moving it into or out of a knowledge base and publishing it for the first time update the due date at once.

## Reminders

The owner of an article is reminded when it becomes due, and once before, at the time of the first reminder. Articles without an owner, for example because the owner's account was deactivated, are reminded to the space admins. The reminders arrive through the notification channels as **Article reviews** and can be changed there like every other notification (see [Notifications](../notifications.md)).

A reminder is sent at most once per due date. When the due date changes, the reminders move with it.

## Review list

**Review** in the sidebar of the knowledge base lists the articles that are due or overdue, due within 30 days, whose source page changed, or that have no owner. The sidebar entry shows how many are due. Everyone with edit rights in the knowledge base sees the list, each person only with the articles they may edit.

The list shows title, area or topic, owner, interval, last review and the state, both as text and as a ring that fills up as the interval passes. **Show** filters the list:

| Filter | Articles |
|---|---|
| All | every article in the list |
| Due | due, overdue or with a changed source page |
| Within 30 days | due within the next 30 days |
| Without owner | articles whose owner is missing or left |
| Translations | outdated translations (see [Knowledge base translations](knowledge-base-translations.md#outdated-translations)) |

**Only my articles** shows the articles you own. Articles without an owner show **Set owner** to space admins, who choose a person with edit rights by name. See [Owners](../spaces-and-pages/owners.md).

## Marking as reviewed

Anyone with edit rights marks an article as reviewed, with **Mark as reviewed** in the review list, on **For you** or at the top of the article. The review is recorded in the article's history with who and when, without a new version, and the next due date starts from now. Only published articles can be marked as reviewed. The confirmation offers **Undo** for a short time. Every review and every undo is recorded in the [audit log](../../admin/audit-log.md), as `article.reviewed` and `article.reviewUndone`.

When you publish a changed article and tick **Content reviewed** in the publish dialog, the publication also counts as a review. The box is not ticked by default.

**For you** shows your own due articles under **Due for review** (see [Knowledge bases](../knowledge-bases.md#for-you)).

In the portal, an article with a review interval that was reviewed at least once shows "Last reviewed on" with the date of the last review; otherwise it shows "Updated on" with the date of the published version.

## Source pages

An article can be based on internal pages, for example the operating documentation of a service. When a source page changes, the article needs a review.

1. Open the article.
2. Next to **Source pages:** click **Add source page**.
3. Search the page by title and click **Add source page**.

A source page must be a page in a space of the same organization that is neither a knowledge base nor confidential, and you must be able to read it. An article has at most 20 source pages.

When a source page is published with changes, the article shows **Source page changed** in the review list until it is marked as reviewed, and the people set under **Who is reminded** are notified once; without an owner, the space admins. Only people who can read the article are notified. Live pages count each saved version as a change. The notification and the review list name the article, never the source page.

- In Lunedo, the link to a source page and its title are shown only to people who can read the source page. For everyone else the source does not exist.
- Readers of the portal never see source pages, and they are not part of the article's content or its machine-readable form.
- Editors of the article see how many linked source pages they cannot read, and can remove those links, for example when the person who linked a restricted page has left. Only people who can read such a page can link it again.

Adding and removing a source page is recorded in the [audit log](../../admin/audit-log.md).
