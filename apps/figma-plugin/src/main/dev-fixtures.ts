export async function generateDevelopmentFixtures(): Promise<SceneNode[]> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
  const fixtures: SceneNode[] = [];
  fixtures.push(createBasicFrame());
  fixtures.push(createRoughCard());
  fixtures.push(createNestedLayout());
  fixtures.push(createOverlay());
  fixtures.push(createInstanceFixture());
  fixtures.push(await createMixedFontFixture());
  fixtures.push(createInvalidComponentFixture());
  arrange(fixtures);
  figma.currentPage.selection = fixtures;
  figma.viewport.scrollAndZoomIntoView(fixtures);
  figma.commitUndo();
  return fixtures;
}

function createBasicFrame(): FrameNode {
  const frame = baseFrame('fixture/basic-frame', 240, 140);
  frame.appendChild(rectangle('Surface', 208, 108, { r: 0.9, g: 0.93, b: 1 }));
  return frame;
}

function createRoughCard(): FrameNode {
  const card = baseFrame('fixture/rough-card', 360, 180);
  const image = rectangle('Image', 120, 148, { r: 0.78, g: 0.84, b: 0.92 });
  image.x = 16;
  image.y = 16;
  const title = text('Title', 'A rough article card', 18);
  title.x = 156;
  title.y = 24;
  const body = text('Body', 'Loose layers for an agent to restructure.', 12);
  body.x = 156;
  body.y = 62;
  card.appendChild(image);
  card.appendChild(title);
  card.appendChild(body);
  return card;
}

function createNestedLayout(): FrameNode {
  const root = baseFrame('fixture/nested-layout', 320, 160);
  root.layoutMode = 'VERTICAL';
  root.itemSpacing = 12;
  root.paddingTop = root.paddingRight = root.paddingBottom = root.paddingLeft = 16;
  root.primaryAxisSizingMode = 'AUTO';
  root.counterAxisSizingMode = 'FIXED';
  for (let index = 0; index < 2; index += 1) {
    const row = baseFrame(`Row ${index + 1}`, 288, 48);
    row.layoutMode = 'HORIZONTAL';
    row.itemSpacing = 8;
    row.fills = [];
    row.appendChild(rectangle('Icon', 32, 32, { r: 0.3, g: 0.55, b: 0.9 }));
    row.appendChild(text('Label', `Nested row ${index + 1}`, 14));
    root.appendChild(row);
  }
  return root;
}

function createOverlay(): FrameNode {
  const frame = baseFrame('fixture/overlay', 260, 160);
  frame.layoutMode = 'VERTICAL';
  frame.paddingTop = frame.paddingRight = frame.paddingBottom = frame.paddingLeft = 16;
  frame.appendChild(rectangle('Media', 228, 128, { r: 0.25, g: 0.28, b: 0.34 }));
  const badge = text('Badge', 'NEW', 11);
  frame.appendChild(badge);
  badge.layoutPositioning = 'ABSOLUTE';
  badge.x = 196;
  badge.y = 12;
  return frame;
}

function createInstanceFixture(): InstanceNode {
  const component = figma.createComponent();
  component.name = 'fixture/component-source';
  component.resizeWithoutConstraints(180, 64);
  component.appendChild(text('Label', 'Configurable instance', 13));
  const instance = component.createInstance();
  instance.name = 'fixture/instance';
  return instance;
}

async function createMixedFontFixture(): Promise<TextNode> {
  const node = text('fixture/mixed-font', 'Regular and Bold', 16);
  try {
    const bold = { family: 'Inter', style: 'Bold' } as const;
    await figma.loadFontAsync(bold);
    node.setRangeFontName(12, 16, bold);
  } catch {
    node.name += ' (bold unavailable)';
  }
  return node;
}

function createInvalidComponentFixture(): FrameNode {
  const frame = baseFrame('fixture/invalid-component', 220, 120);
  const first = figma.createComponent();
  const second = figma.createComponent();
  first.name = 'State=One';
  second.name = 'State=Two';
  figma.combineAsVariants([first, second], frame).name = 'Nested Component Set';
  return frame;
}

function baseFrame(name: string, width: number, height: number): FrameNode {
  const frame = figma.createFrame();
  frame.name = name;
  frame.resizeWithoutConstraints(width, height);
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  return frame;
}

function rectangle(name: string, width: number, height: number, color: RGB): RectangleNode {
  const node = figma.createRectangle();
  node.name = name;
  node.resize(width, height);
  node.fills = [{ type: 'SOLID', color }];
  return node;
}

function text(name: string, characters: string, fontSize: number): TextNode {
  const node = figma.createText();
  node.name = name;
  node.fontName = { family: 'Inter', style: 'Regular' };
  node.characters = characters;
  node.fontSize = fontSize;
  return node;
}

function arrange(nodes: SceneNode[]): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    figma.currentPage.appendChild(node);
    node.x = (index % 3) * 420;
    node.y = Math.floor(index / 3) * 260;
  }
}
