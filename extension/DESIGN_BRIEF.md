# Extension UI direction

Register: restrained consumer product UI. The user is browsing a store and needs one quick path from a product image to a live preview.

Focus: the toolbar popup offers only **Open fitting room** and **Tutorial**. The page control is a dismissible black camera launcher. The fitting room is a floating, resizable video window with a quiet white header and a large image-drop target over the video. Starter looks and controls remain available in a compact footer. No product feed, sizing claim, or extra onboarding screen.

Expected states:

```text
P1 popup:    VIRTUAL TRY-ON · OPENWEAR
             [ camera  Open fitting room ]
             [ info    Tutorial          ]

L1 launcher: [ camera  AI fitting room   × ]  (page edge; can dismiss)

R1 room:     [    Try-On ✦ OpenWear       ⚙  ⤢  − ]
             [                                    ]
             [       camera or AI video           ]
             [    Drag a product image here       ]
             [ OpenWear · visual-preview notice   ]
             [ garment strip | upload image       ]
             [ status | enable/stop/save           ]

T1 tutorial: [ step 1 / 3 → step 2 / 3 → step 3 / 3 → Open fitting room ]
```

Visual evidence from the three user-provided screenshots:

| Observed trait | Decision | Local constraint |
| --- | --- | --- |
| White popup, tracked gray eyebrow, two dark actions | Adapt | Use OpenWear branding and accessible controls; preserve the two-action hierarchy. |
| Black camera launcher with close affordance | Adopt | Dismiss only the page launcher; toolbar popup remains the recovery path. |
| Large floating video with white header and over-video drop zone | Adapt | Preserve resizable width, live status, garment choice, stop, and save controls. |
| User-requested holographic transformation cue | Adapt | One short teal light band moves down the video only when a garment is applied; it never blocks controls, loops, or plays under reduced motion. |
| Reference product's name and imagery | Reject | No copied assets or branding. |

Taste dials: density 5/10, variance 3/10, motion 4/10, color commitment 3/10, materiality 4/10. Arial/system typography; white, charcoal, and muted gray with a transient teal light accent; simple camera and image line icons; shadow only for floating surfaces. The video is the sole visual focal point. The wave communicates an apply request, not a guarantee that the generated frames are already complete.

Proof target: popup actions reach an existing or newly injected content script, tutorial advances through three steps, launcher opens/minimizes/dismisses, the room can expand and resize, a user can drag an image or public product link onto the stage, and garment application shows a brief wave. Browser runtime and webcam proof must be distinguished from build/typecheck proof.
