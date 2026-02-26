Im looking to implement an "always on agent" that helps me with my daily work as
a software engineer at my job.

we use way to many tools that are not native AI powered and I have to do a lot
of manual footwork. in the last few weeks i built a few tools to help me.

@technik-sde/lido-cli (private npm package, available here) sonar-sweep (public
npm package) slackline (~/Code/Slackline)

I also use gh-cli and jira-cli regularly.

There is also the entire MS Teams Suite with Mail, Calendar. Also confluence.

We also use DevOps tool such as spacelift, argocd, aws.

I work on many different repos/projects (last I counted its 30+)

I want to write agent (base on http://pi.dev, inspired by
https://deepwiki.com/mikeyobrien/rho) that helps me with all of this. It's
supposed to be a human in the loop system that can propose actions based on
slack messages, calendar events, emails, pull request reviews/request for
reviews and other inputs. It should be able to interact with the tools I
mentioned above to automate tasks, fetch information, and assist me in my daily
work.

It should also build a "memory" of my work habits, preferences, and the context
of my projects to provide more personalized assistance over time.

The agent can be a set of extensions or plugins ontop of pi. Im a console
junkie that uses tmux, so a CLI interface is fine. 

A web interface from my phone later on would be anice extra.

This is a big task, so first order of business is to write it down into a spec
and do the research on established agent frameworks and tools (like rho or
openclaw). how they deal with memory, tool integration, and human in the loop
interactions. For research you can probably use deepwiki as linked above using
the agent browser skill. Please do a thoroguh research and planning session.
Write it all into markdown files that we can reference in the future.

Make sure we are starting small and building larger over time and dont make a
plan that solves everything at once. 

Most crucial for now: When working with the pi coding agent, it needs to
remember work accross repos (they have similar setups) and be able to search
jira, slack, github effectively.
